import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_URL = "https://gemini.google.com/app";
const RESULT_WAIT_MS = 3 * 60 * 1000;
const DEFAULT_PROMPT =
  "extend and upscale this picture so that it is good for the background of a laptop screen.";

function expandPath(value) {
  return value
    .replaceAll("${HOME}", os.homedir())
    .replaceAll("$HOME", os.homedir())
    .replace(/^~\//, `${os.homedir()}/`);
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadPrompt() {
  const file = path.join(__dirname, "config.env");
  if (!fs.existsSync(file)) return DEFAULT_PROMPT;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("GEMINI_PROMPT=")) continue;
    return expandPath(unquote(trimmed.slice("GEMINI_PROMPT=".length).trim()));
  }
  return DEFAULT_PROMPT;
}

function runAppleScript(source, args = []) {
  return execFileSync("osascript", ["-e", source, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function runAppleScriptFile(source, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-safari-"));
  const scriptPath = path.join(dir, "run.applescript");
  fs.writeFileSync(scriptPath, source);
  try {
    return execFileSync("osascript", [scriptPath, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let geminiWindow = 1;
let geminiTab = 1;

function safariEval(js) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-safari-"));
  const jsPath = path.join(dir, "step.js");
  fs.writeFileSync(jsPath, js);
  const source = `on run argv
  set js to read POSIX file (item 1 of argv) as «class utf8»
  set winIndex to (item 2 of argv) as integer
  set tabIndex to (item 3 of argv) as integer
  tell application "Safari"
    set index of window winIndex to 1
    tell window winIndex
      set current tab to tab tabIndex
      return do JavaScript js in current tab
    end tell
  end tell
end run
`;
  try {
    return runAppleScriptFile(source, [jsPath, String(geminiWindow), String(geminiTab)]);
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    if (message.includes("Allow JavaScript from Apple Events")) {
      throw new Error(
        "Safari is blocking the script. In Safari, open Settings > Developer and turn on Allow JavaScript from Apple Events. Then run this again.",
      );
    }
    throw error;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function systemEvents(source) {
  try {
    runAppleScript(source);
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    if (message.includes("assistive") || message.includes("-1719") || message.includes("-1728")) {
      throw new Error(
        "macOS blocked the keystroke. In System Settings > Privacy & Security > Accessibility, allow osascript (and Cursor, if it is listed). Then run this again.",
      );
    }
    throw error;
  }
}

function ensureGeminiTab() {
  const created = runAppleScriptFile(`tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document with properties {URL:"${GEMINI_URL}"}
    return "1,1"
  end if
  set index of window 1 to 1
  tell window 1
    set newTab to make new tab with properties {URL:"${GEMINI_URL}"}
    set current tab to newTab
    return "1," & (index of newTab)
  end tell
end tell
`);
  const [windowIndex, tabIndex] = created.split(",").map((value) => Number(value.trim()));
  geminiWindow = windowIndex;
  geminiTab = tabIndex;
}

function assertGemini() {
  const href = safariEval("location.href");
  if (!href.includes("gemini.google.com")) {
    throw new Error(`Safari is not on Gemini (${href}).`);
  }
}

async function attachImage(inputPath) {
  assertGemini();
  const overlay = safariEval(`(() => {
    const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
    if (!dialog) return "clear";
    const close = [...dialog.querySelectorAll("button")].find((el) => /close|back/i.test(el.getAttribute("aria-label") || ""));
    if (close) close.click();
    return close ? "closed" : "open";
  })()`);
  if (overlay === "open") {
    systemEvents(`tell application "Safari" to activate
delay 0.2
tell application "System Events" to key code 53`);
    await sleep(400);
  }
  const opened = safariEval(`(() => {
    const button = [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "Upload & tools" && el.getClientRects().length > 0);
    if (!button) return "no-button";
    button.click();
    return "clicked";
  })()`);
  if (opened !== "clicked") throw new Error("Could not find Gemini's Upload & tools button.");
  await sleep(800);
  const clicked = safariEval(`(() => {
    const input = document.querySelector('input[type="file"][accept="image/*"]');
    if (!input) return "no-input";
    input.click();
    return "clicked";
  })()`);
  if (clicked !== "clicked") throw new Error("Could not open Gemini's image picker.");
  await sleep(800);

  systemEvents(`tell application "Safari" to activate
delay 0.2
tell application "System Events"
  tell process "Safari"
    set frontmost to true
    try
      set position of window 1 to {80, 40}
    end try
    keystroke "g" using {command down, shift down}
    delay 0.7
    keystroke ${JSON.stringify(inputPath)}
    delay 0.3
    key code 36
    delay 0.8
    key code 36
  end tell
end tell`);

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = safariEval(`(() => {
      const labels = [...document.querySelectorAll("button")].map((el) => el.getAttribute("aria-label") || "");
      return labels.some((label) => /close attachment|send message/i.test(label)) ? "yes" : "no";
    })()`);
    if (ready === "yes") return;
    await sleep(500);
  }
  throw new Error("The screenshot did not attach in Gemini.");
}

function pressReturn() {
  systemEvents(`tell application "Safari" to activate
delay 0.2
tell application "System Events" to key code 36`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pageState() {
  const raw = safariEval(`(() => {
    const signedOut = [...document.querySelectorAll("a,button")].some((el) => {
      const label = (el.innerText || el.getAttribute("aria-label") || "").trim();
      return /^sign in$/i.test(label) && el.getClientRects().length > 0;
    });
    const composer = document.querySelector('[aria-label*="prompt" i], [role="textbox"]');
    return JSON.stringify({
      signedOut,
      hasComposer: !!composer,
      url: location.href
    });
  })()`);
  return JSON.parse(raw);
}

function imageList() {
  const raw = safariEval(`JSON.stringify([...document.querySelectorAll("img")].map((img) => ({
    src: img.currentSrc || img.src,
    w: img.naturalWidth,
    h: img.naturalHeight
  })).filter((img) => img.src))`);
  return JSON.parse(raw || "[]");
}

function composerScript(body) {
  return `(() => {
    const boxes = [...document.querySelectorAll('[aria-label="Enter a prompt for Gemini"], [aria-label="Ask Gemini"], [aria-label="Write with Gemini"], [role="textbox"]')]
      .filter((el) => el.getClientRects().length > 0);
    const box = boxes[boxes.length - 1];
    if (!box) return "missing";
    ${body}
  })()`;
}

function insertPrompt(prompt) {
  const payload = JSON.stringify(prompt);
  const typed = safariEval(composerScript(`
    box.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertText", false, ${payload});
    return (box.innerText || "").includes("extend and upscale") ? "ok" : "empty";
  `));
  if (typed === "ok") return;

  safariEval(composerScript(`
    box.focus();
    document.execCommand("selectAll", false, null);
    return "focused";
  `));
  runAppleScriptFile(`on run argv
  tell application "Safari" to activate
  delay 0.2
  tell application "System Events" to keystroke (item 1 of argv)
end run
`, [prompt]);
  const confirmed = safariEval(composerScript(`
    return (box.innerText || "").includes("extend and upscale") ? "ok" : "missing";
  `));
  if (confirmed !== "ok") {
    throw new Error("The prompt was not entered in Gemini.");
  }
}

function clickSend() {
  return safariEval(`(() => {
    const button = [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "Send message");
    if (!button || button.disabled) return "no-send";
    button.click();
    return "clicked";
  })()`);
}

function responseIsGenerating() {
  const state = safariEval(`(() => {
    const labels = [...document.querySelectorAll("button")].map((el) => (el.getAttribute("aria-label") || "").trim());
    return labels.some((label) => /^stop/i.test(label)) ? "yes" : "no";
  })()`);
  return state === "yes";
}

async function waitForNewImage(beforeSources) {
  const before = new Set(beforeSources.map((img) => img.src));
  const started = Date.now();
  const deadline = started + RESULT_WAIT_MS;
  let sawGeneration = false;
  let stableSrc = "";
  let stablePolls = 0;

  while (Date.now() < deadline) {
    if (responseIsGenerating()) sawGeneration = true;
    const created = imageList()
      .filter((img) => !before.has(img.src) && img.w >= 400 && img.h >= 400)
      .sort((a, b) => b.w * b.h - a.w * a.h);
    const best = created[0];
    const ready = best && !responseIsGenerating() && (sawGeneration || Date.now() - started > 20000);
    if (ready && best.src === stableSrc) {
      stablePolls += 1;
      if (stablePolls >= 2) return best;
    } else if (ready) {
      stableSrc = best.src;
      stablePolls = 1;
    } else {
      stableSrc = "";
      stablePolls = 0;
    }
    await sleep(2000);
  }
  throw new Error("Gemini did not return an image in time.");
}

async function saveImage(outputPath) {
  const started = Date.now();
  const clicked = safariEval(`(() => {
    const buttons = [...document.querySelectorAll("button")].filter((el) => (el.getAttribute("aria-label") || "") === "Download full size image");
    if (!buttons.length) return "none";
    buttons[buttons.length - 1].click();
    return "clicked";
  })()`);
  if (clicked !== "clicked") throw new Error("Could not find Gemini's full-size download.");

  const downloadDir = path.join(os.homedir(), "Downloads");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const downloaded = fs
      .readdirSync(downloadDir)
      .map((name) => path.join(downloadDir, name))
      .filter((file) => {
        try {
          const stat = fs.statSync(file);
          return stat.isFile() && stat.mtimeMs >= started - 2000 && /\.(png|jpe?g|webp)$/i.test(file);
        } catch {
          return false;
        }
      })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (downloaded[0] && fs.statSync(downloaded[0]).size > 0) {
      execFileSync("sips", ["-s", "format", "png", downloaded[0], "--out", outputPath]);
      return;
    }
    await sleep(500);
  }
  throw new Error("The full-size image did not finish downloading.");
}

function imagePairs(argv) {
  const paths = argv.slice(2);
  if (paths.length < 2 || paths.length % 2 !== 0) return null;
  const pairs = [];
  for (let i = 0; i < paths.length; i += 2) {
    pairs.push([path.resolve(paths[i]), path.resolve(paths[i + 1])]);
  }
  return pairs;
}

async function extendOne(inputPath, outputPath) {
  await attachImage(inputPath);
  const before = imageList();
  insertPrompt(loadPrompt());
  assertGemini();
  if (clickSend() !== "clicked") pressReturn();

  await waitForNewImage(before);
  await saveImage(outputPath);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("Wallpaper file was not written.");
  }
  fs.unlinkSync(inputPath);
  console.log(`Saved ${outputPath}`);
  console.log(`Removed ${inputPath}`);
}

async function main() {
  const loginOnly = process.argv.includes("--login");
  const pairs = loginOnly ? [] : imagePairs(process.argv);

  if (!loginOnly && !pairs) {
    console.error("Usage: node extend-wallpaper.mjs <screenshot.png> <wallpaper.png> [...]");
    console.error("       node extend-wallpaper.mjs --login");
    process.exitCode = 1;
    return;
  }
  if (!loginOnly) {
    for (const [inputPath] of pairs) {
      if (!fs.existsSync(inputPath)) {
        console.error(`Screenshot not found: ${inputPath}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  try {
    ensureGeminiTab();
    const readyDeadline = Date.now() + 30000;
    let state = null;
    while (Date.now() < readyDeadline) {
      try {
        assertGemini();
        state = pageState();
        if (state.hasComposer && !state.signedOut) break;
      } catch {
        state = null;
      }
      await sleep(1000);
    }
    if (!state || state.signedOut || !state.hasComposer) {
      console.error("Gemini is not signed in on this Safari tab. Sign in there, then run this again.");
      process.exitCode = 1;
      return;
    }
    if (loginOnly) {
      console.log("Gemini is open in Safari. This uses Safari's existing login.");
      return;
    }

    safariEval(`(() => {
      const button = [...document.querySelectorAll("button, a")].find((el) => /new chat/i.test((el.getAttribute("aria-label") || el.innerText || "").trim()));
      if (button) button.click();
      return "ok";
    })()`);
    await sleep(1000);

    for (const [inputPath, outputPath] of pairs) {
      await extendOne(inputPath, outputPath);
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

await main();
