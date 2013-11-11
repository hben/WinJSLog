/// <reference path="//Microsoft.WinJS.1.0/js/base.js" />
/// <reference path="//Microsoft.WinJS.1.0/js/ui.js" />

(function () {
    "use strict";

    var logs = [], pages = [], methods = []; // log data
    var loggingServer, loggingEnabled, debugEnabled; // service setting
    var version, manufacturer, model; // app context
    var currentLevel = 'debug', levels = { 'debug': 1, 'info': 2, 'warning': 3, 'error': 4, 'crash': 5 };

    // register logging service
    function registerLogging(serverUrl, doDebugging, deferRunInSeconds, recheckInSeconds) {
        if (!serverUrl) {
            throw 'registerLogging error: logging server not defined.';
        }

        loggingEnabled = true;
        loggingServer = serverUrl;
        debugEnabled = doDebugging || false;
        deferRunInSeconds = deferRunInSeconds || 30;
        recheckInSeconds = recheckInSeconds || 60;

        // Register event handler for suspend, resume and relaunch (terminated then restarted)
        WinJS.Application.addEventListener("activated", restoreSessionData);
        Windows.UI.WebUI.WebUIApplication.addEventListener("suspending", suspend);
        Windows.UI.WebUI.WebUIApplication.addEventListener("resuming", resume);

        // defer to run the check-log-file-and-send process
        WinJS.Promise.timeout(deferRunInSeconds * 1000).then(function () {
            cleanupLogs(recheckInSeconds);
        });
    }

    // unregister logging service
    function unregisterLogging() {
        loggingEnabled = false;
        WinJS.Application.removeEventListener("activated", restoreSessionData);
        Windows.UI.WebUI.WebUIApplication.removeEventListener("suspending", suspend);
        Windows.UI.WebUI.WebUIApplication.removeEventListener("resuming", resume);
    }

    // restore logging data after app relaunch from terminated state
    function restoreSessionData(args) {
        if (args && args.detail && args.detail.kind === Windows.ApplicationModel.Activation.ActivationKind.launch) {
            if (args.detail.previousExecutionState === Windows.ApplicationModel.Activation.ApplicationExecutionState.terminated) {
                var sessionState = WinJS.Application.sessionState;
                if (sessionState.logPages)
                    pages = sessionState.logPages;
                if (sessionState.logMethods)
                    methods = sessionState.logMethods;
                if (sessionState.logLogs)
                    logs = sessionState.logLogs;
                if (sessionState.logLevel)
                    currentLevel = sessionState.logLevel;
            }
        }
    }

    // log suspending event and store log data into session
    function suspend() {
        if (loggingEnabled) {
            var pageEntry = { 'time': new Date(), 'page': 'suspending' };
            pages.push(pageEntry);
            var sessionState = WinJS.Application.sessionState;
            sessionState.logPages = pages;
            sessionState.logMethods = methods;
            sessionState.logLogs = logs;
            sessionState.logLevel = currentLevel;
        }
    }

    // log resuming event
    function resume() {
        if (loggingEnabled) {
            var pageEntry = { 'time': new Date(), 'page': 'resuming' };
            pages.push(pageEntry);
        }
    }

    // log an event: navigate to a page
    function pageLog(pageId) {
        if (loggingEnabled) {
            try {
                processMemoryLogs();
            } catch (e) { }
            var pageEntry = { 'time': new Date(), 'page': pageId };
            pages.push(pageEntry);
        }
    }

    // log an event: invoke a method
    function methodLog(methodName) {
        if (loggingEnabled) {
            methods.push(methodName);
        }
    }

    // log a crash; a crash or unhandled exception can be caught by WinJS.Application.onerror event
    function crashLog(err) {
        if (loggingEnabled) {
            setLevel('crash');
            var errWrapper = getErrorObject(err);
            errWrapper.level = "crash";
            errWrapper.time = new Date();
            logs.push(errWrapper);
            try {
                processMemoryLogs();
            } catch (e) { }
        }
    }

    // log an error
    function errorLog(description, err) {
        if (loggingEnabled) {
            setLevel('error');
            logs.push(getLogObject('error', description, err));
        }
    }

    // log a warning message
    function warningLog(description, err) {
        if (loggingEnabled && debugEnabled) {
            setLevel('warning');
            logs.push(getLogObject('warning', description, err));
        }
    }

    // log an info message
    function infoLog(description) {
        if (loggingEnabled && debugEnabled) {
            setLevel('info');
            logs.push(getLogObject('info', description));
        }
    }

    // log a debug message
    function debugLog(description) {
        if (loggingEnabled && debugEnabled) {
            setLevel('debug');
            logs.push(getLogObject('debug', description));
        }
    }

    // build a log object
    function getLogObject(level, description, err) {
        var logObject = getErrorObject(err);
        if (logObject.description) {
            logObject.description = logObject.description + description;
        } else {
            logObject.description = description || '';
        }
        logObject.level = level || 'unknown';
        logObject.time = new Date();
        return logObject;
    }

    // build an error object
    function getErrorObject(err) {
        var errObject = {};
        if (err) {
            if (err.detail && typeof err.detail === 'object') {
                var detail = err.detail;
                if (detail.promise) {
                    errObject.source = "promise";
                }
                if (detail.errorMessage) {
                    errObject.message = detail.errorMessage;
                    if (detail.errorLine)
                        errObject.codeline = detail.errorLine;
                    if (detail.errorUrl)
                        errObject.sourcUrl = detail.errorUrl;
                } else if (detail.error && typeof detail.error === 'object') {
                    errObject.message = detail.error.message || 'unknown';
                    if (detail.error.description)
                        errObject.description = detail.error.description;
                    if (detail.error.stack)
                        errObject.stacktrace = detail.error.stack;
                } else {
                    errObject.message = detail.message || 'unknown';
                    if (detail.description)
                        errObject.description = detail.description;
                    if (detail.number)
                        errObject.codeline = detail.number;
                    if (detail.stack)
                        errObject.stacktrace = detail.stack;
                }
            } else {
                errObject.message = err.message || err.exception || err;
            }
        }
        return errObject;
    }

    // determine the highest log level for current log entry
    function setLevel(level) {
        if (levels[level] > levels[currentLevel]) {
            currentLevel = level;
        }
    }

    // periodically check the memory logs and storage logs, and send logs to server if Internet is available
    function cleanupLogs(recheckInseonds) {
        if (loggingEnabled) {
            processMemoryLogs();
            processFileLogs();
            setTimeout(function () {
                cleanupLogs(recheckInseonds);
            }, recheckInseonds * 1000);
        }
    }

    // construct log message and send to server if Internet is available, otherwise save it to local storage
    function processMemoryLogs() {
        if (logs.length > 0) {
            var data = getContext();
            var date = new Date();
            data.logtime = date.toLocaleString() + ' [' + date.toISOString() + ']';
            if (pages.length > 0) {
                var pagetrace = pages.map(function (item) {
                    if (item.time && item.time.toLocaleTimeString)
                        return item.page + "[" + item.time.toLocaleTimeString().replace(' ', '') + ']';
                    else
                        return item.page + "[" + item.time + ']';
                }).join(' => ');
                data.pagetrace = pagetrace;
            }
            if (methods.length > 0) {
                data.methodtrace = methods.join(' => ');
            }
            data.level = currentLevel;
            data.log = logs.slice(0); //(logs.length == 1) ? logs[0] : logs.slice(0);

            if (isConnectedToInternet()) {
                sendLogsToServer(JSON.stringify(data));
            } else {
                saveLogsToFile(data);
            }
        }

        // clean up the logs
        methods = [];
        logs = [];
        currentLevel = 'debug';
    }

    // read all saved log files and send them to server if Internet is available
    function processFileLogs() {
        if (isConnectedToInternet()) {
            var localFolder = Windows.Storage.ApplicationData.current.localFolder;
            localFolder.getFilesAsync().then(function (files) {
                files.forEach(function (file) {
                    if (file && file.displayName && file.displayName.indexOf("logs") == 0) {
                        Windows.Storage.FileIO.readTextAsync(file).then(function (text) {
                            sendLogsToServer(text);
                        }).then(function () {
                            file.deleteAsync();
                        }).done(function () { }, function (err) { });
                    }
                });
            });
        }
    }

    // save a log entry to file system if Internet is not available
    function saveLogsToFile(obj) {
        var fileName = "logs.txt";
        var content = JSON.stringify(obj);
        var localFolder = Windows.Storage.ApplicationData.current.localFolder;
        var saveOption = Windows.Storage.CreationCollisionOption;
        localFolder.createFileAsync(fileName, saveOption.generateUniqueName).then(
            function (file) {
                return Windows.Storage.FileIO.writeTextAsync(file, content);
            }).done(function () {
                console.log("Log saved");
            }, function (error) {
                console.log("Log saved error");
            });
    }

    // send log message to logging server
    function sendLogsToServer(jsonData) {
        WinJS.xhr({
            type: "post",
            url: loggingServer,
            headers: { "Content-type": "application/json" },
            data: jsonData
        }).done(function completed(c) {
            console.log("log sent");
        },
        function error(e) { // One more try? send to different server? or silently skip?
            console.log("log sent error");
        });
    }

    // get current application context
    function getContext() {
        if (!version) {
            var appVersion = Windows.ApplicationModel.Package.current.id.version;
            version = appVersion.major + "." + appVersion.minor + "." + appVersion.build + "." + appVersion.revision;
            try {
                var deviceInfo = new Windows.Security.ExchangeActiveSyncProvisioning.EasClientDeviceInformation();
                manufacturer = deviceInfo.systemManufacturer;
                model = deviceInfo.systemProductName;
            } catch (e) {
                manufacturer = 'unknown';
                model = 'unknown';
            }
        }
        var context = {};
        context.version = version;
        context.manufacturer = manufacturer;
        context.model = model;
        context.os = "Windows 8";
        context.lang = navigator.appName == "Netscape" ? navigator.language : navigator.userLanguage;
        context.screen = screen.width + "x" + screen.height;
        context.orientation = getOrientation();
        context.timezone = (-(new Date()).getTimezoneOffset() / 60).toString();
        return context;
    }

    // determine current orientation
    function getOrientation() {
        var orientation = "unknown";
        switch (Windows.Graphics.Display.DisplayProperties.currentOrientation) {
            case Windows.Graphics.Display.DisplayOrientations.landscape:
                orientation = "landscape";
                break;
            case Windows.Graphics.Display.DisplayOrientations.portrait:
                orientation = "portrait";
                break;
            case Windows.Graphics.Display.DisplayOrientations.landscapeFlipped:
                orientation = "landscapeFlipped";
                break;
            case Windows.Graphics.Display.DisplayOrientations.portraitFlipped:
                orientation = "portraitFlipped";
                break;
        }
        return orientation;
    }

    // check if Internet access is available
    function isConnectedToInternet() {
        var connectivity = Windows.Networking.Connectivity;
        var profile = connectivity.NetworkInformation.getInternetConnectionProfile();
        if (profile) {
            var connected = (profile.getNetworkConnectivityLevel() == connectivity.NetworkConnectivityLevel.internetAccess);
            return connected;
        } else {
            return false;
        }
    }

    WinJS.Namespace.define("Logging", {
        registerLogging: registerLogging,
        unregisterLogging: unregisterLogging,
        page: pageLog,
        method: methodLog,
        fatal: crashLog,
        error: errorLog,
        warning: warningLog,
        info: infoLog,
        debug: debugLog
    });
})();
