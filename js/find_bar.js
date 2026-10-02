"use strict";

// Renderer for the find bar view (find_bar.html). main.js owns the view and runs
// webContents.findInPage on the main window; this page only collects input.
(function () {
    const { ipcRenderer } = require('electron');

    const input = document.querySelector('input');
    const countLabel = document.querySelector('.count');
    const TYPING_PAUSE_MS = 300; // wait for a typing pause before the automatic first search
    let typingTimer = null;
    let searching = false; // true once a findInPage session has started (later calls may step within it)

    // continuing=false starts a new session; true steps within the current one.
    function search(forward, continuing) {
        if (input.value === '') {
            return;
        }
        ipcRenderer.invoke('find-in-page', input.value, {
            forward: forward,
            newSession: !(continuing && searching),
        });
        searching = true;
    }

    function stopSearch() {
        if (searching) {
            ipcRenderer.invoke('stop-find-in-page');
            searching = false;
        }
        countLabel.textContent = '';
    }

    // Next/Previous: a pending first search runs now, in the asked direction, instead of stepping past it.
    function navigate(forward) {
        if (typingTimer !== null) {
            clearTimeout(typingTimer);
            typingTimer = null;
            search(forward, false);
        } else {
            search(forward, true);
        }
    }

    function close() {
        clearTimeout(typingTimer);
        typingTimer = null;
        searching = false; // main.js clears the highlights when it hides the view
        countLabel.textContent = '';
        ipcRenderer.invoke('close-find-bar');
    }

    input.addEventListener('input', function () {
        clearTimeout(typingTimer);
        typingTimer = null;
        countLabel.textContent = ''; // the old count belongs to the old query
        if (input.value === '') {
            stopSearch();
        } else {
            typingTimer = setTimeout(function () {
                typingTimer = null;
                search(true, false);
            }, TYPING_PAUSE_MS);
        }
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Enter') {
            if (e.isComposing || e.keyCode === 229) {
                return; // Enter confirms an IME candidate; it is not a search command
            }
            e.preventDefault();
            navigate(!e.shiftKey);
        } else if (e.code === 'KeyF' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            input.select();
        }
    });
    document.querySelector('.next').addEventListener('click', function () { navigate(true); });
    document.querySelector('.prev').addEventListener('click', function () { navigate(false); });
    document.querySelector('.close').addEventListener('click', close);

    ipcRenderer.on('find-bar-show', function () {
        input.focus();
        input.select();
        if (input.value !== '') {
            search(true, false);
        }
    });
    ipcRenderer.on('found-in-page-result', function (event, result) {
        if (!searching || !result.final) {
            return;
        }
        countLabel.textContent = result.matches === 0 ? '0 of 0' : result.active + ' of ' + result.matches;
    });
})();
