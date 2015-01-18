var _ = require("lodash");
var patterns = {
    version: /^Starting minecraft server version ([.0-9a-zA-Z]+)$/,
    done: /^Done \([.,0-9a-zA-Z]+\)!/,
    join: /^(\w+) ?(\[(.+)\] )?logged in with entity id (\d+) at \(([\d\s\-\.,]+)\)$/,
    leave: /^(\w+) lost connection: (.+)$/,
    bind: /^\*+ FAILED TO BIND TO PORT\!$/,
    authenticate: /^UUID of player (\w+) is (.+)$/,
    message: /^<(.+)>\s(.+)/,
    kill: /^([^<]+) (was slain by|was shot by|was killed by) (.+?)( using \[([^\]]+)\])?$/,
    inGameEvent: /^(\[([\w@]+): )?(.+?)(\])?$/,
    // patterns for in-game events
    ban: /^Banned player (\w+)$/,
    unban: /^Unbanned player (\w+)$/,
    op: /^Opped (\w+)$/,
    deop: /^De-opped (\w+)$/,
    score: /^Set score of (\w+) for player (\w+) to (\d+)$/,
    experience: /^Given (\d+) experience to (\w+)$/,
    stopping: /^Stopping the server$/,
    spawnpoint: /^Set (\w+)\'s spawn point to \((-?\d+), (-?\d+), (-?\d+)\)$/,
    teleport: /^Teleported (\w+) to (-?[.\d]+), (-?[.\d]+), (-?[.\d]+)$/
};

// modify game info/state
exports.version = function(game, meta) {
    var match = meta.text.match(patterns.version);

    if (match) {
        game.version = match[1];
        game.emit("version", match[1]);
    }
};

exports.authenticated = function(game, meta) {
    if (meta.source && (meta.source.indexOf('User Authenticator #') === 0)) {
        var match = meta.text.match(patterns.authenticate),
                player, uuid;

        if (match) {
            game.emit("authenticated", match[1], match[2]);
        }
    }
};

exports.joined = function(game, meta) {
    var match = meta.text.match(patterns.join),
            player, coord;

    if (match) {
        player = match[1];
        coord = match[5].split(", ");

        game.players.push(player);

        game.emit("joined", player, {
            source: match[3],
            entity: +match[4],
            location: {
                x: parseFloat(coord[0]),
                y: parseFloat(coord[1]),
                z: parseFloat(coord[2])
            }
        });
    }
};

exports.left = function(game, meta) {
    var match = meta.text.match(patterns.leave);

    if (match) {
        game.players = _.without(game.players, match[1]);
        game.emit("left", match[1], match[2]);
    }
};

exports.killed = function(game, meta) {
    var match = meta.text.match(patterns.kill);

    if (match) {
        game.emit("killed", match[1], match[3], match[5]);
    }
};

exports.message = function(game, meta) {
    if ((meta.level === "INFO") && (meta.source === 'Server thread')) {
        var match = meta.text.match(patterns.message);

        if (match) {
            game.emit("message", match[1], match[2]);
        }
    }
};

// informational
exports.error = function(game, meta) {
    if (meta.level === "ERROR") {
        game.emit("error", new Error(meta));
    }
};

exports.fail2bind = function(game, meta) {
    if (meta.level === "WARNING" && patterns.bind.test(meta.text)) {
        game.emit("error", new Error(meta));
    }
};

exports.started = function(game, meta) {
    if (patterns.done.test(meta.text)) {
        game.emit("started");
    }
};

// save status
exports.saveoff = function(game, meta) {
    if (meta.text === "Turned off world auto-saving") {
        game.emit("saveoff");
    }
};

exports.saveon = function(game, meta) {
    if (meta.text === "Turned on world auto-saving") {
        game.emit("saveon");
    }
};

exports.saved = function(game, meta) {
    if (meta.text === "Saved the world") {
        game.emit("saved");
    }
};

// in-game event handlers

var inGameHandlers = {
    banned: function(game, source, text) {
        var match = text.match(patterns.ban);

        if (match) {
            game.emit("banned", source, match[1]);
        }
    },
    unbanned: function(game, source, text) {
        var match = text.match(patterns.unban);

        if (match) {
            game.emit("unbanned", source, match[1]);
        }
    },
    opped: function(game, source, text) {
        var match = text.match(patterns.op);

        if (match) {
            game.emit("opped", source, match[1]);
        }
    },
    deopped: function(game, source, text) {
        var match = text.match(patterns.deop);
        if (match) {
            game.emit("deopped", source, match[1]);
        }
    },
    stopping: function(game, source, text) {
        var match = text.match(patterns.stopping);
        if (match) {
            game.emit("stopping", source);
        }
    },
    scored: function(game, source, text) {
        var match = text.match(patterns.score);
        if (match) {
            game.emit("scored", source, match[2], match[1], parseInt(match[3], 10));
        }
    },
    xpGiven: function(game, source, text) {
        var match = text.match(patterns.experience);
        if (match) {
            game.emit("xpGiven", source, match[2], parseInt(match[1], 10));
        }
    },
    spawnpointSet: function(game, source, text) {
        var match = text.match(patterns.spawnpoint);
        if (match) {
            game.emit("spawnpointSet", source, match[1], {x: parseInt(match[2], 10), y: parseInt(match[3], 10), z: parseInt(match[4], 10)});
        }
    },
    teleported: function(game, source, text) {
        var match = text.match(patterns.teleport);
        if (match) {
            game.emit("teleported", source, match[1], {x: parseFloat(match[2]), y: parseFloat(match[3]), z: parseFloat(match[4])});
        }
    }
};

exports.inGameEvent = function(game, meta) {
    var match = meta.text.match(patterns.inGameEvent);
    if (match) {
        _.each(inGameHandlers, function(fn) {
            fn(game, match[2], match[3]);
        });
    }
};
