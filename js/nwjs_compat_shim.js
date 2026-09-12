"use strict";

/*
 * Chrome-Apps-API compatibility shim for code carried over from the NW.js build.
 * NW.js polyfilled a subset of the Chrome Apps APIs (chrome.storage, chrome.i18n,
 * chrome.runtime, chrome.fileSystem); Electron provides none of them. This backs
 * each one used by this codebase with a real Electron/Node equivalent so the
 * call sites in pref_storage.js, release_checker.js, localization.js, and
 * flightlog_video_renderer.js need no changes.
 *
 * Must load before any script that touches chrome.*.
 */
(function () {
    const { ipcRenderer } = require('electron');
    const fs = require('fs');
    const path = require('path');

    window.chrome = window.chrome || {};

    // chrome.storage.local -> localStorage. Real chrome.storage.local always calls back
    // asynchronously (Chrome docs, chrome-apps-shim behavior under NW.js too); some call sites
    // (js/main.js's graphConfig default) rely on that — a flightLog set earlier in the same
    // tick, by a file passed on the command line, needs to exist by the time this fires. Defer
    // with setTimeout to preserve that contract instead of calling back synchronously.
    window.chrome.storage = {
        local: {
            get: function (keys, callback) {
                const names = Array.isArray(keys) ? keys : [keys];
                const result = {};
                names.forEach(function (name) {
                    const raw = localStorage.getItem(name);
                    // Real chrome.storage.local omits a key from the result entirely when
                    // nothing is stored under it — it does not include it with a null value.
                    // localStorage.getItem returns null for a missing key too, and
                    // JSON.parse(null) parses cleanly as the JSON literal `null` (it does not
                    // throw), so that distinction has to be made explicitly here or callers
                    // that assume "my key is present, possibly with a falsy value" (e.g.
                    // js/main.js's saveOneUserSetting: `data[name] = value`) crash on first run.
                    if (raw === null) {
                        return;
                    }
                    try {
                        result[name] = JSON.parse(raw);
                    } catch (e) {
                        // malformed stored value; leave unset
                    }
                });
                setTimeout(function () { callback(result); }, 0);
            },
            set: function (items, callback) {
                Object.keys(items).forEach(function (name) {
                    localStorage.setItem(name, JSON.stringify(items[name]));
                });
                if (callback) setTimeout(callback, 0);
            },
        },
    };

    // chrome.i18n.getMessage -> _locales/<locale>/messages.json (Chrome i18n message format)
    let messages = null;
    function loadMessages() {
        if (!messages) {
            // __dirname for a <script src>-loaded file is the loading HTML document's
            // directory (index.html, at the repo root), not this file's own folder.
            const localeFile = path.join(__dirname, '_locales', 'en', 'messages.json');
            messages = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
        }
        return messages;
    }

    window.chrome.runtime = { lastError: null };

    window.chrome.i18n = {
        getMessage: function (messageID, substitutions) {
            const entry = loadMessages()[messageID];
            if (!entry) {
                return '';
            }
            let message = entry.message;
            if (substitutions) {
                const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
                subs.forEach(function (sub, i) {
                    message = message.split('$' + (i + 1)).join(sub);
                });
            }
            return message;
        },
    };

    // chrome.fileSystem.chooseEntry -> Electron save dialog + fs-backed random-access FileWriter.
    // WebMWriter (js/vendor/webm-writer/BlobBuffer.js) issues sequential seek()+write() pairs and
    // awaits onwriteend before the next one, but write() captures its target offset synchronously
    // so out-of-order completion of the underlying fs.write() callback can never misplace bytes.
    function makeFileWriter(filePath) {
        const fd = fs.openSync(filePath, 'w+');
        let position = 0;
        let closed = false;
        return {
            onerror: null,
            onwriteend: null,
            // Not part of the real FileWriter API — js/flightlog_video_renderer.js calls this
            // once export finishes, since nothing else here ever closes the descriptor otherwise.
            close: function () {
                if (!closed) {
                    closed = true;
                    fs.closeSync(fd);
                }
            },
            truncate: function (size) {
                try {
                    fs.ftruncateSync(fd, size);
                    position = Math.min(position, size);
                    if (this.onwriteend) this.onwriteend();
                } catch (e) {
                    if (this.onerror) this.onerror(e);
                }
            },
            seek: function (offset) {
                position = offset;
            },
            write: function (blob) {
                const writer = this;
                const writeOffset = position;
                position += blob.size;

                // fs.write() can complete with bytesWritten < buffer.length (POSIX doesn't
                // guarantee a single write() call covers the whole buffer); retry the unwritten
                // remainder instead of silently reporting success on a truncated file.
                function writeFully(buffer, offset) {
                    fs.write(fd, buffer, offset, buffer.length - offset, writeOffset + offset, function (err, bytesWritten) {
                        if (err) {
                            if (writer.onerror) writer.onerror(err);
                            return;
                        }
                        // A successful call reporting 0 bytes written for a non-empty remainder never
                        // makes progress — retrying it recurses forever instead of erroring out.
                        if (bytesWritten === 0 && offset < buffer.length) {
                            if (writer.onerror) writer.onerror(new Error('fs.write() wrote 0 bytes'));
                            return;
                        }
                        if (offset + bytesWritten < buffer.length) {
                            writeFully(buffer, offset + bytesWritten);
                            return;
                        }
                        if (writer.onwriteend) writer.onwriteend();
                    });
                }

                blob.arrayBuffer().then(function (arrayBuffer) {
                    writeFully(Buffer.from(arrayBuffer), 0);
                }).catch(function (err) {
                    // Without this, a rejected arrayBuffer() never calls onwriteend/onerror,
                    // and BlobBuffer.js's sequential writes (each awaiting onwriteend before the
                    // next) stall forever.
                    if (writer.onerror) writer.onerror(err);
                });
            },
        };
    }

    window.chrome.fileSystem = {
        chooseEntry: function (options, callback) {
            ipcRenderer.invoke('show-save-dialog', {
                defaultPath: options.suggestedName,
                filters: (options.accepts || []).map(function (accept) {
                    return { name: 'File', extensions: accept.extensions };
                }),
            }).then(function (filePath) {
                if (!filePath) {
                    window.chrome.runtime.lastError = { message: 'User cancelled' };
                    callback(null);
                    return;
                }
                window.chrome.runtime.lastError = null;
                callback({
                    createWriter: function (onSuccess, onError) {
                        try {
                            onSuccess(makeFileWriter(filePath));
                        } catch (e) {
                            onError(e);
                        }
                    },
                });
            }).catch(function (err) {
                // Without this, a rejected show-save-dialog IPC call never calls back at all,
                // and the caller's Promise((resolve, reject) => chooseEntry(..., callback))
                // waits forever.
                window.chrome.runtime.lastError = { message: err.message || String(err) };
                callback(null);
            });
        },
    };
})();
