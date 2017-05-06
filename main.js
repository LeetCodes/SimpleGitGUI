//The main process
"use strict";

//=====Load Modules=====
//Load Electron
const {app, BrowserWindow: win, ipcMain: ipc, dialog} = require("electron");
//Load common utilities
const path = require("path");
const url = require("url");
const fs = require("fs");
//Load other utilities
const git = require("./git.js");
const TQ = require("./task-queue.js");
//Configuration
let config; //The config object, will be set when initializing
const configFile = path.join(app.getPath("userData"), "config.json");
const configBlank = { //The default config if the config file doesn't exist
    lastPath: app.getPath("home"),
    name: "Alpha",
    email: "alpha@example.com",
    savePW: true,
    active: -1,
    repos: [] //Each entry is an object with properties name and directory
};
console.log("The configuration file is located at: ");
console.log(configFile);

//=====Main=====
//Create window
let main;
app.on("ready", () => {
    //Init window
    main = new win({
        width: 1400,
        height: 700,
        minHeight: 350,
        minWidth: 1050
    });
    //Remove menu
    main.setMenu(null);
    //Set URL
    main.loadURL(url.format({
        pathname: path.join(__dirname, "index.html"),
        protocol: "file",
        slashes: true
    }));
    //Handle exit
    main.on("closed", () => {
        app.quit();
    });
});

//=====Helper Functions=====
//Save the configuration
const configSave = function (callback) {
    fs.writeFile(configFile, JSON.stringify(config), (err) => {
        callback(err);
    });
};
//Refresh current repository, draw commands will be sent to renderer
const gitRefresh = function (sender, callback) {
    let tq = new TQ();
    const activeDir = (config.repos[config.active]).directory;
    //Get branches
    tq.push(() => {
        git.getBranches(activeDir, (err, stdout) => {
            if (err) {
                //Can't get branches
                sender.send("error", {
                    title: "Git Error",
                    msg: "Could not read branches list. ",
                    log: err.message
                });
                tq.abort();
            } else {
                //Parse branches
                let branches = stdout.split("\n");
                let names = [];
                let active;
                for (let i = 0; i < branches.length; i++) {
                    if (branches[i].startsWith("*")) {
                        active = i;
                        branches[i] = (branches[i]).substring(1);
                    }
                    let temp = (branches[i]).trim();
                    temp && names.push(temp);
                }
                //Tell renderer to draw branches and buttons
                sender.send("draw branches", {
                    names: names,
                    active: active
                });
                sender.send("draw buttons", {
                    group1: true,
                    group2: true
                });
                tq.tick();
            }
            callback(err);
        });
    });
    //Get changed files
    tq.push(() => {
        git.getChanges(activeDir, (err, stdout) => {
            if (err) {
                sender.send("error", {
                    title: "Git Error",
                    msg: "Could not read changed files list. ",
                    log: err.message
                });
            } else {
                //Parse output
                const files = stdout.split("\n");
                let changedFiles = [];
                for (let i = 0; i < files.length; i++) {
                    if (!files[i]) {
                        //Skip empty lines
                        continue;
                    }
                    //Get changed file name
                    let file = (files[i]).substring(2).trim().split("/");
                    let File = {
                        name: file.pop(),
                        directory: "/" + file.join("/"),
                        state: []
                    };
                    for (let j = 0; j < 2; j++) {
                        switch ((files[i]).charAt(j)) {
                            case " ":
                                File.state.push("Unchanged");
                                break;
                            case "M":
                                File.state.push("Changed");
                                break;
                            case "D":
                                File.state.push("Deleted");
                                break;
                            case "R":
                                File.state.push("Renamed");
                                break;
                            case "C":
                                File.state.push("Copied");
                                break;
                            case "U":
                                File.state.push("CHANGED BUT UNMERGED");
                                break;
                            case "?":
                                File.state.push("Untracked");
                                break;
                            default:
                                sender.send("error", {
                                    title: "Git Error",
                                    msg: "Could not parse file changes. ",
                                    log: files[i]
                                })
                                callback({
                                    message: files[i]
                                });
                                return;
                        }
                    }
                    //Add file to the list
                    changedFiles.push(File);
                }
                //Tell renderer to draw the table
                sender.send("draw changes", {
                    data: changedFiles
                });
                //Unlock action buttons
                sender.send("draw buttons", {
                    group1: true
                });
            }
            callback(err);
        });
    });
    //TODO: show normal status to user

    //Start the queue
    tq.tick();
};
//Send repos list redraw request
const drawRepos = function (sender) {
    //List repositories 
    let reposList = [];
    for (let i = 0; i < config.repos.length; i++) {
        reposList.push((config.repos[i]).name);
    }
    //Ask renderer to draw repos list
    sender.send("draw repos", {
        names: reposList,
        active: config.active
    });
};
//Send ready message, along with some data used to render UI
const sendReady = function (sender) {
    sender.send("ready", {
        lastPath: config.lastPath,
        name: config.name,
        email: config.email,
        savePW: config.savePW
    });
};

//=====Special Events=====
//DevTools shortcut keys
ipc.on("dev-tools", (e) => {
    //Toggle DevTools
    e.sender.toggleDevTools();
});

//=====Main Events=====
//Do initialization
ipc.on("ready", (e) => {
    let tq = new TQ();
    //Read config
    tq.push(() => {
        //Check if config exists
        fs.exists(configFile, (exists) => {
            if (exists) {
                //Exists, try to read and parse it
                fs.readFile(configFile, (err, data) => {
                    if (err) {
                        //Can't access the file
                        e.sender.send("fatal error", {
                            title: "Config Error",
                            msg: "Could not read the config file. ",
                            log: err.message
                        });
                        tq.abort();
                    } else {
                        //File read, try to parse it
                        try {
                            config = JSON.parse(data);
                            tq.tick();
                        } catch (err) {
                            e.sender.send("fatal error", {
                                title: "Config Error",
                                msg: "Could not parse the config file. ",
                                log: err.message
                            });
                            tq.abort();
                        }
                    }
                })
            } else {
                //Doesn't exist, use default config
                config = configBlank;
                tq.tick();
            }
        });
    });
    //Connect to Git
    tq.push(() => {
        try {
            git.init(config.name, config.email, config.savePW, (err) => {
                if (err) {
                    e.sender.send("fatal error", {
                        title: "Git Error",
                        msg: "Could not initialize Git. ",
                        log: err.message
                    });
                    tq.abort();
                } else {
                    tq.tick();
                }
            });
        } catch (err) {
            e.sender.send("fatal error", {
                title: "Config Error",
                msg: "The config file is damaged. ",
                log: err.message
            });
            tq.abort();
        }
    });
    //Get all repositories
    tq.push(() => {
        try {
            //Check active index
            let active = parseInt(config.active);
            if (active < -1 || active > (config.repos.length - 1)) {
                throw {
                    message: "Active repository index is not valid. "
                };
            }
            config.active = active; //Sanitize it
            //Draw repos list or place holder
            drawRepos(e.sender);
            //Check if there are any repository
            if (config.repos.length) {
                //Refresh the active repository
                gitRefresh(e.sender, (err) => {
                    if (err) {
                        e.sender.send("draw buttons", {
                            group1: false
                        });
                    } else {
                        sendReady(e.sender);
                    }
                });
            } else {
                config.repos = []; //Sanitize it
                //Ask renderer to lock some inputs if there is no repository
                e.sender.send("draw buttons", {
                    group1: false,
                    group2: false
                });
                //We don't have any repository, we don't need to get branches
                sendReady(e.sender);
            }
        } catch (err) {
            e.sender.send("fatal error", {
                title: "Config Error",
                msg: "The config file is damaged. ",
                log: err.message
            });
            tq.abort();
        }
    });
    //Start the queue
    tq.tick();
});
//Refresh
ipc.on("refresh", (e) => {
    gitRefresh(e.sender, (err) => {
        if (err) {
            e.sender.send("draw buttons", {
                group1: false
            });
        } else {
            sendReady(e.sender);
        }
    });
});
//Push changes
ipc.on("push", (e, data) => {
    let func; //We'll check if we need to stage and commit, and decide which function to use
    let tq = new TQ();
    //Check if we need to stage
    tq.push(() => {
        git.getChanges((config.repos[config.active]).directory, (err, stdout) => {
            if (err) {
                sender.send("error", {
                    title: "Git Error",
                    msg: "Could not read changed files list. ",
                    log: err.message
                });
                //We haven't pushed, so don't refresh
                tq.abort();
            } else {
                if (stdout.length) {
                    func = git.push;
                } else {
                    func = git.pushOnly;
                }
                tq.tick();
            }
        });
    });
    //Push
    tq.push(() => {
        func((config.repos[config.active]).directory, data.msg, (err) => {
            if (err) {
                e.sender.send("error", {
                    title: "Git Error",
                    msg: "Failed to push. ",
                    log: err.message
                });
                //We will refresh the repository even if push fails
                tq.tick();
            } else {
                tq.tick();
            }
        });
    });
    //Refresh
    tq.push(() => {
        gitRefresh(e.sender, (err) => {
            if (err) {
                e.sender.send("draw buttons", {
                    group1: false
                });
            } else {
                sendReady(e.sender);
            }
        });
    });
    //Start the queue
    tq.tick();
});
//Clone a repository
ipc.on("clone", (e, data) => {
    let tq = new TQ();
    //Create the folder
    tq.push(() => {
        fs.exists(data.directory, (exists) => {
            if (exists) {
                //Exists, let's see if it's empty
                fs.readdir(data.directory, function (err, files) {
                    if (err) {
                        //Could not access the directory
                        e.sender.send("error", {
                            title: "IO Error",
                            msg: "Could not access directory. ",
                            log: err.message
                        });
                        tq.abort();
                    } else {
                        if (files.length) {
                            //Directory is used
                            e.sender.send("error", {
                                title: "IO Error",
                                msg: "Directory not empty. ",
                                log: `There are ${files.length} files in this directory. `
                            });
                            tq.abort();
                        } else {
                            //Directory is empty, proceed
                            tq.tick();
                        }
                    }
                });
            } else {
                //Create the directory
                fs.mkdir(data.directory, (err) => {
                    if (err) {
                        //Failed to create directory
                        e.sender.send("error", {
                            title: "IO Error",
                            msg: "Could not create directory. ",
                            log: err.message
                        });
                        tq.abort();
                    } else {
                        //Ready, proceed
                        tq.tick();
                    }
                });
            }
        });
    });
    //Clone the repository
    tq.push(() => {
        git.clone(data.directory, data.address, (err) => {
            if (err) {
                e.sender.send("error", {
                    title: "Git Error",
                    msg: "Could not clone this repository. ",
                    log: err.message
                });
                tq.abort();
            } else {
                //Add this new repository to the config object
                config.repos.push({
                    name: data.directory.split(/\/|\\/).pop(),
                    directory: data.directory
                });
                config.active = config.repos.length - 1;
                //Update UI
                drawRepos(e.sender);
                e.sender.send("draw buttons", {
                    //Group 1 will be handled by refresh
                    group2: true
                });
                tq.tick();
            }
        });
    });
    //Save config
    tq.push(() => {
        //Update last path
        config.lastPath = path.resolve(data.directory, "..");
        configSave((err) => {
            if (err) {
                e.sender.send("Fatal Error", {
                    title: "Config Error",
                    msg: "Could not save config. ",
                    log: err.message
                });
                tq.abort();
            } else {
                gitRefresh(e.sender, (err) => {
                    if (err) {
                        e.sender.send("draw buttons", {
                            group1: false
                        });
                    } else {
                        sendReady(e.sender);
                    }
                });
            }
        });
    });
    //Start the queue
    tq.tick();
});
//Delete current repository
ipc.on("delete", (e) => {
    let tq = new TQ();
    //Save config
    tq.push(() => {
        config.repos.splice(config.active, 1);
        if (config.active > config.repos.length - 1) {
            config.active--;
        }
        configSave((err) => {
            if (err) {
                e.sender.send("Fatal Error", {
                    title: "Config Error",
                    msg: "Could not save config. ",
                    log: err.message
                });
                tq.abort();
            } else {
                tq.tick();
            }
        });
    });
    //Update UI
    tq.push(() => {
        drawRepos(e.sender);
        //Check if buttons should be active
        if (config.repos.length) {
            //Refresh the new repository
            gitRefresh(e.sender, (err) => {
                if (err) {
                    e.sender.send("draw buttons", {
                        group1: false
                    });
                } else {
                    sendReady(e.sender);
                }
            });
        } else {
            //Lock buttons and clear branches and table
            e.sender.send("draw buttons", {
                group1: false,
                group2: false
            });
            e.sender.send("draw branches", {
                names: []
            });
            e.sender.send("draw changes", {
                data: []
            });
            //Send ready
            sendReady(e.sender);
        }
    });
    //Start the queue
    tq.tick();
});
//Update name and email
ipc.on("update", (e, data) => {
    let tq = new TQ();
    //Save config
    tq.push(() => {
        config.name = data.name;
        config.email = data.email;
        configSave((err) => {
            if (err) {
                e.sender.send("Fatal Error", {
                    title: "Config Error",
                    msg: "Could not save config. ",
                    log: err.message
                });
                tq.abort();
            } else {
                tq.tick();
            }
        });
    });
    //Update Git config
    tq.push(() => {
        git.update(data.name, data.email, data.savePW, (err) => {
            if (err) {
                e.sender.send("fatal error", {
                    title: "Git Error",
                    msg: "Could not update Git config. ",
                    log: err.message
                });
                tq.abort();
            } else {
                sendReady(e.sender);
            }
        });
    });
    //Start the queue
    tq.tick();
});
