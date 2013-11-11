winjslog.js
==============
A logging and reporting JavaScript module for Windows Store Apps.
##How to use

The WinJSLogging module exposes following functions:
<blockquote>
<pre>    function fatal(error)                // log crash
    function error(description, error)   // log error
    function warning(error, description) // log warning
    function page(pageName)              // navigate to a page
    function method(methodName)          // invoke a method
    function registerLogging()           // register logging
    function unregisterLogging()         // unregister logging
	</pre></blockquote>
First include the winjslog.js file inside default.html or your custom page, then register the logging service before app.start():
<blockquote><pre>function () {
    "use strict";
    WinJS.Binding.optimizeBindingReferences = true;

    var app = WinJS.Application;
    var nav = WinJS.Navigation;

    app.addEventListener("activated", function (args) {
      ...// skip for abreviation
    }); 
   
    app.onerror = function (e) {
        Logging.fatal(e); // log fatal (crash) error
        Logging.page("home"); // optionally log the navigation history
        nav.navigate("/pages/home/home.html");  // go to home page when app crashes
        return true; // the app will terminate if false
    };

    Logging.registerLogging("http://myloggingserver/");
    
    app.start();

    ...// skip for abreviation
})();	
</pre></blockquote>
In above code an onerror event handler is registered to catch the unhandled exception to avoid the app's crash, log the crash by Logging.fatal(e), then redirect to home page. Note that the action of redirecting to home page is also logged as a navigation path by Logging.page() function. Following code snippet shows how to log a function invocation and its potential error message:
<blockquote><pre>    function doComplicatedTask() {
        Logging.method("doComplicatedTask");
        try {
            ... // job with potential error
        } catch (e) {
            logging.error("Error occur!", e);
        }
    }</pre></blockquote>
Alternatively you can log lower level warning, info and debug message by using Logging.warning(), Logging.info() and logging.debug() functions respectively.
