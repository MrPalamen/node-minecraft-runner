var _ = require("lodash"),
    patterns = {
        version:      /^Starting minecraft server version ([.0-9a-zA-Z]+)$/,
        done:         /^Done \([.,0-9a-zA-Z]+\)!/,
        join:         /^(\w+) ?(\[(.+)\] )?logged in with entity id (\d+) at \(([\d\s\-\.,]+)\)$/,
        leave:        /^(\w+) lost connection: (.+)$/,
        bind:         /^\*+ FAILED TO BIND TO PORT\!$/,
        authenticate: /^UUID of player (\w+) is (.+)$/,
        ban:          /^(\[([\w@]+): )?Banned player (\w+)(\])?$/,
        unban:        /^(\[([\w@]+): )?Unbanned player (\w+)(\])?$/,
        op:           /^(\[([\w@]+): )?Opped (\w+)(\])?$/,
        deop:         /^(\[([\w@]+): )?De-opped (\w+)(\])?$/,
        score:        /^(\[([\w@]+): )?Set score of (\w+) for player (\w+) to (\d+)(\])?$/,
        message:      /^<(.+)>\s(.+)/,
        kill:         /^([^<]+) (was slain by|was shot by|was killed by) (.+?)( using \[([^\]]+)\])?$/,
        stopping:     /^(\[([\w@]+): )?Stopping the server(\])?$/
    };


// modify game info/state
exports.version = function (game, meta) {
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
}

exports.joined = function (game, meta) {
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

exports.left = function (game, meta) {
    var match = meta.text.match(patterns.leave);

    if (match) {
        game.players = _.without(game.players, match[1]);
        game.emit("left", match[1], match[2]);
    }
};

exports.banned = function (game, meta) {
    var match = meta.text.match(patterns.ban);

    if (match) {
        game.emit("banned", match[2], match[3]);
    }
};

exports.unbanned = function (game, meta) {
    var match = meta.text.match(patterns.unban);

    if (match) {
        game.emit("unbanned", match[2], match[3]);
    }
};

exports.opped = function (game, meta) {
    var match = meta.text.match(patterns.op);

    if (match) {
        game.emit("opped", match[2], match[3]);
    }
};

exports.deopped = function (game, meta) {
    var match = meta.text.match(patterns.deop);

    if (match) {
        game.emit("deopped", match[2], match[3]);
    }
};

exports.scored = function (game, meta) {
    var match = meta.text.match(patterns.score);

    if (match) {
        game.emit("scored", match[2], match[4], match[3], parseInt(match[5], 10));
    }
};

exports.killed = function (game, meta) {
    var match = meta.text.match(patterns.kill);

    if (match) {
        game.emit("killed", match[1], match[3], match[5]);
    }
};

exports.message = function (game, meta) {
    if ((meta.level === "INFO") && (meta.source === 'Server thread')) {
        var match = meta.text.match(patterns.message);

        if (match) {
            game.emit("message", match[1], match[2]);
        }
    }
};

// informational
exports.error = function (game, meta) {
    if (meta.level === "ERROR") {
        game.emit("error", new Error(meta));
    }
};

exports.fail2bind = function (game, meta) {
    if (meta.level === "WARNING" && patterns.bind.test(meta.text)) {
        game.emit("error", new Error(meta));
    }
};

// start/stop
exports.started = function (game, meta) {
    if (patterns.done.test(meta.text)) {
        game.emit("started");
    }
};

exports.stopping = function(game, meta) {
    var match = meta.text.match(patterns.stopping);

    if (match) {
        game.emit("stopping", match[2]);
    }
};

// save status
exports.saveoff = function (game, meta) {
    if (meta.text === "Turned off world auto-saving") {
        game.emit("saveoff");
    }
};

exports.saveon = function (game, meta) {
    if (meta.text === "Turned on world auto-saving") {
        game.emit("saveon");
    }
};

exports.saved = function (game, meta) {
    if (meta.text === "Saved the world") {
        game.emit("saved");
    }
};
