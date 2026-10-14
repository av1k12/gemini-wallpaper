import CoreFoundation
import CoreGraphics
import Dispatch
import Foundation

@_silgen_name("CGSessionCopyCurrentDictionary")
func CGSessionCopyCurrentDictionary() -> Unmanaged<CFDictionary>?

/// True when the login session is locked. A missing flag means unlocked.
func sessionIsLocked() -> Bool {
    guard let session = CGSessionCopyCurrentDictionary()?.takeRetainedValue() else {
        return false
    }
    let info = session as NSDictionary
    if let locked = info["CGSSessionScreenIsLocked"] as? Bool {
        return locked
    }
    if let locked = info["CGSSessionScreenIsLocked"] as? NSNumber {
        return locked.boolValue
    }
    return false
}

private func unlockNote(
    _ center: CFNotificationCenter?,
    _ observer: UnsafeMutableRawPointer?,
    _ name: CFNotificationName?,
    _ object: UnsafeRawPointer?,
    _ userInfo: CFDictionary?
) {
    if !sessionIsLocked() {
        CFRunLoopStop(CFRunLoopGetMain())
    }
}

if !sessionIsLocked() {
    exit(0)
}

CFNotificationCenterAddObserver(
    CFNotificationCenterGetDistributedCenter(),
    nil,
    unlockNote,
    "com.apple.screenIsUnlocked" as CFString,
    nil,
    .deliverImmediately
)

let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
timer.schedule(deadline: .now() + 2, repeating: 2)
timer.setEventHandler {
    if !sessionIsLocked() {
        CFRunLoopStop(CFRunLoopGetMain())
    }
}
timer.resume()

while sessionIsLocked() {
    CFRunLoopRun()
}
