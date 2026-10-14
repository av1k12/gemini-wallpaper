# Gemini wallpaper capture

This is a personal wallpaper tool for artwork saved from Instagram.

I follow a lot of cool artwork accounts. A post is often a carousel of several slides. This program screenshots a chosen number of those slides, then sends each one through Gemini to extend and upscale it so I can use the results as wallpapers on my own computer.

Nothing runs on a schedule. It runs only when you start it, with an Instagram post already open on screen.

## What a run does

```bash
./capture.sh 5
```

Replace `5` with how many screenshots you want.

1. Waits until the Mac is unlocked.
2. Wakes the display.
3. Captures the rectangle in `config.env` that many times. That rectangle should frame one slide of the post. After every shot except the last, it clicks the point in `config.env` and waits one second. Put that point on Instagram's next-slide control so each screenshot is the next image in the carousel.
4. Opens one new Gemini tab in Safari, starts one new chat, and attaches each screenshot there with the same prompt.
5. Downloads Gemini's full-size image and saves it as a PNG.
6. Deletes the original screenshot only after that wallpaper file exists and is not empty.

The Mac has to be awake, logged in, and unlocked, with the lid open. The script cannot see through the lock screen.

## Setup

You need macOS, Safari, Node.js, and the Xcode Command Line Tools (`swiftc` compiles a small lock-screen helper on first run).

```bash
cp config.example.env config.env
```

Edit `config.env`:

| Setting | Meaning |
| --- | --- |
| `REGION` | Screenshot rectangle in points: `x,y,width,height`, measured from the top-left of the main display. |
| `CLICK` | Point clicked between screenshots, in the same coordinates. Required when the count is greater than 1. |
| `OUTPUT_DIR` | Folder for screenshots and wallpapers. It is created if missing. |
| `GEMINI_PROMPT` | Text sent with every image. |

Press Shift-Command-4, drag the area you want, and read the coordinates. Press Escape before releasing the drag so macOS does not save a shot. `config.env` stays on your machine and is not part of this repo.

Sign in to [Gemini](https://gemini.google.com/app) in Safari before the first run.

## Permissions

- **Screen Recording** for the app that launches the script, usually Terminal. If capture fails with `could not create image from rect`, turn this on, then quit and reopen Terminal.
- **Accessibility** for `osascript`, so the script can click and type.
- **Safari: Allow JavaScript from Apple Events.** Show the Develop menu, open Develop, then Developer Settings, and turn that checkbox on. macOS will ask for your password.

## Output

Files go in `OUTPUT_DIR`:

- `YYYY-MM-DD-1.png` is a screenshot
- `YYYY-MM-DD-1-wallpaper.png` is the Gemini result

Numbering continues after the highest wallpaper index already saved that day, so a later run does not overwrite earlier results.

Gemini's site chooses the downloaded size. The script saves that full-size download as a PNG. It does not resize the file to a specific pixel count after download.

## Files

- `capture.sh` takes the screenshots, clicks between them, then calls the Gemini step.
- `extend-wallpaper.mjs` drives the Gemini tab: upload, prompt, send, download.
- `wait-for-unlock.swift` waits while the screen is locked.
