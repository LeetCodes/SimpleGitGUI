//The Git library for the renderer process
"use strict";

const {exec} = require("child_process");

//Escape argument
const escape = function (text) {
    return text.replace(/("|\\)/g, "\\$1");
};

const format = function (code, err, stdout, stderr) {
    let out = `>>> ${code}\n`;
    if (err) {
        out += `Error code: ${err.code}\n${stderr}`;
    } else if (stdout.length) {
        out += `${stdout}\n`;
    }
    return out;
}

//Run code line by line
const run = function (lines, callback) {
    let output = "";
    let hasError = false;
    //Line runner
    const runner = function () {
        let line;
        if (line = lines.shift()) {
            //We still have code to run
            exec(line, (err, stdout, stderr) => {
                if (err) {
                    hasError = true;
                    //Abort other commands
                    lines = [];
                }
                output += format(line, err, stdout, stderr);
                runner();
            });
        } else {
            callback(output, hasError);
        }
    }
    runner();
};

//Run code and return lines of standard output
const porcelain = function (code, callback) {
    exec(code, (err, stdout, stderr) => {
        if (err) {
            callback(format(code, err, stdout, stderr), true);
        } else {
            callback(format(code, err, stdout, stderr), false, stdout.split("\n"));
        }
    });
};

//Pull
exports.pull = function (directory, callback) {
    run([`git -C "${escape(directory)}" pull --verbose`], callback);
};

//Commit
exports.commit = function (directory, messages, callback) {
    let cmd = `git -C "${escape(directory)}" commit --verbose`;
    //Put in commit comments
    for (let i = 0; i < messages.length; i++) {
        cmd += ` --message="${escape(messages[i])}"`;
    }
    //Run the command
    run([`git -C "${escape(directory)}" stage --verbose --all`, cmd], callback);
};

//Push
exports.push = function (directory, callback) {
    run([`git -C "${escape(directory)}" push --verbose`], callback);
};

//Status
exports.status = function (directory, callback) {
    porcelain(`git -C "${escape(directory)}" status --untracked-files=all`, callback);
};

//Clone
exports.clone = function (address, directory, callback) {
    run([`git -C "${escape(directory)}" clone --quiet --verbose --depth 5 --no-single-branch --recurse-submodules --shallow-submodules "${escape(address)}" "${escape(directory)}"`], callback);
};

//Set config
exports.config = function (name, email, savePW, callback) {
    //Intermediate callback to handle savePW config
    const intermediate = function (output, hasError) {
        if (hasError) {
            callback(output, hasError);
        } else {
            let code = savePW ? `git config --global credential.helper store` : `git config --global --unset credential.helper`;
            exec(code, (err, stdout, stderr) => {
                output += format(code, err, stdout, stderr);
                callback(output, hasError);
            });
        }
    }
    //Run code
    run([
        `git config --global user.name "${escape(name)}"`,
        `git config --global user.email "${escape(email)}"`
    ], intermediate);
};

//Refresh branches list
exports.branches = function (directory, callback) {
    porcelain(`git -C "${escape(directory)}" branch --list --all`, callback);
};

//Refresh changed files list
exports.diff = function (directory, callback) {
    porcelain(`git -C "${escape(directory)}" status --porcelain --untracked-files=all`, callback);
};

//Get diff of one file
exports.fileDiff = function (directory, file, callback) {
    porcelain(`git -C "${escape(directory)}" diff "${escape(file)}"`, callback);
};