var events   = require("events"),
    path     = require("path"),
    spawn    = require("child_process").spawn,
    util     = require("util"),
    _        = require("lodash"),
    noop     = require("nop"),
    byline   = require("byline"),
    patterns = require("./patterns");

/**
 * Create an instance of a minecraft server. Each instance can spawn a process
 * of the game, monitor it's stdout/err, write to it's stdin and emit events
 * as certain events happen within the game itself.
 *
 * @constructor
 * @param {String} dir
 * @param {String} jar
 * @param {Object} options
 */
function Game(dir, jar, options) {
    _.extend(this, options);
    this.dir = dir;
    this.jar = jar;
    this.players = [];

    this.lineStream = new byline.LineStream({encoding: 'utf-8'});
    var game = this;
    this.lineStream.on("data", function(data) {
        if (game.debug) {
            console.log(data.trim());
        }
        if (/^Error/.test(data) || /^Exception/.test(data)) {
            game.emit("error", new Error(data));
        } else if (/^java/.test(data) || /^\s+/.test(data)) {
            game.emit("java", data);
        } else {
            Game.emitLog(game, data);
        }
    });

    events.EventEmitter.call(this);
    //this.setMaxListeners(20);
}

// this is an EventEmitter object
util.inherits(Game, events.EventEmitter);

// default properties
Game.prototype.ram = "1G";
Game.prototype.java = "java";
Game.prototype.status = "Stopped";

// automatically generate the command arguments based on the object's state
Object.defineProperty(Game.prototype, "args", {
    get: function() {
        if (typeof this.classpath === 'undefined') {
            return [
                "-Xms" + this.ram,
                "-Xmx" + this.ram,
                "-Dlog4j.configurationFile=" + (this.log4j || ""),
                "-jar",
                this.jar,
                "nogui"
            ];
        } else {
            return [
                "-Xms" + this.ram,
                "-Xmx" + this.ram,
                "-Dlog4j.configurationFile=" + (this.log4j || ""),
                "-cp",
                this.classpath + ':' + this.jar,
                "net.minecraft.server.MinecraftServer",
                "nogui"
            ];
        }
    }
});

/**
 * Start up a server instance, begin monitoring the process
 *
 * @param {Function} callback  Will run after the server has finished starting
 */
Game.prototype.start = function(callback) {
    var game = this;
    callback = _.once((callback || noop).bind(this));

    if (this.running) {
        return callback(null);
    }

    this.emit("start");
    this.status = "Starting";
    this.process = spawn(this.java, this.args, {cwd: this.dir});

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.pipe(this.lineStream, {end: false});

    this.process.once("exit", function(code) {
        game.status = "Stopped";
        game.process = null;
        game.players = [];

        game.emit("stopped");
    });

    function started() {
        game.status = "Running";
        game.removeListener("started", started);
        game.removeListener("error", error);

        callback(null, game.process);
    }

    function error(err) {
        if (game.process) {
            game.process.kill();
        }

        if (game.status !== "Running") {
            callback(err);
        }
    }

    game.once("started", started);
    game.once("error", error);
};

Game.prototype.stop = function(callback) {
    var game = this,
            done = function() {
                game.removeListener("stopped", done);
                game.removeListener("error", done);
                callback.apply(game, arguments);
            };

    callback = (callback || noop).bind(this);

    if (!this.process) {
        return callback(null);
    }

    this.emit("stop");
    this.status = "Stopping";
    this.command("stop");
    this.once("stopped", done);
    this.once("error", done);
};

Game.prototype.restart = function(callback) {
    this.stop(function(err) {
        this.start((callback || noop).bind(this));
    });
};

Game.prototype.command = function() {
    if (!this.process) {
        return false;
    }

    return this.process.stdin.write([].join.call(arguments, " ") + "\n");
};

Game.prototype.say = function(msg) {
    return this.command("say", msg);
};

Game.prototype.tellRaw = function(target, data) {
    return this.command("tellraw", target, JSON.stringify(data));
};

Game.prototype.title = function(target, data) {
    return this.command("title", target, "title", JSON.stringify(data));
};

Game.prototype.tellError = function(target, msg) {
    return this.tellRaw(target, [{text: msg, color: 'red'}]);
};

Game.prototype.addObjective = function(name, criteria, displayName) {
    return this.command('scoreboard', 'objectives', 'add', name, criteria || 'dummy', displayName || name);
};

Game.prototype.setScore = function(target, objective, score) {
    return this.command('scoreboard', 'players', 'set', target, objective, score);
};

Game.parseLog = function(line) {
    // example: [15:48:42] [Server thread/INFO]: Preparing start region for level 0
    var pattern = /^\[([\d:]+)\]\s\[([\w\s#]+)\/(\w+)\]:\s(.+)/;
    var match = line.trim().match(pattern);
    if (match) {
        return {
            datetime: match[1],
            source: match[2],
            level: match[3],
            text: match[4]
        };
    } else {
        return {
            text: line
        };
    }
};

Game.emitLog = function(game, log) {
    var meta = Game.parseLog(log);
    game.emit("log", meta);
    _.each(patterns, function(fn) {
        fn(game, meta);
    });
};

module.exports = Game;
