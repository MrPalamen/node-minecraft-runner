var fs = require('fs-extra');
var Game = require("minecraft-runner");
var colors = require('colors');
var Properties = require("minecraft-server-properties");
var Query = require("mcquery");
var Utils = require("./Utils");
var UserDB = require("./UserDB");


// global variables
var configFile = __dirname + '/config.json';
var allGroups = ['default', 'vip', 'mod', 'admin'];

// reading a config file and actual start code
var config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
var game = new Game(config.path, config.path + config.jar);
var userDB = new UserDB(__dirname);

var restart, restartTimeout, restarting, // various restart info
        tipsInterval,
        currentGame, newGame, // currentGame contains infotmation about active game, newGame is set during the restart
        serverProps = {},
        requests = {}, // active tp requests
        bannedDB, // a cache of banned users
        gameVotes = {}, // votes for game change
        lastSlotFailTime = 0;

// declaring callback for server start

var startCallback = function(err) {
    if (err) {
        console.log('Start error: ' + colors.red(err));
    } else {
        console.log("Started without errors".green);
        // create restart timeout. callback code will run after restartInterval milleseconds
        if (config.restartInterval) {
            restartTimeout = setTimeout(function() {
                restart(game);
            }, config.restartInterval);
        }
    }
};

var restart = function(game, cfg) {
    // restart code
    if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = undefined;
    }
    if (tipsInterval) {
        clearInterval(tipsInterval);
        tipsInterval = undefined;
    }
    if (game.status === 'Running') {
        restarting = true;
        console.log('==================== Server restarting ===================='.yellow);
        game.tellRaw('@a', [{text: 'Restarting in 30 seconds', color: 'red'}]);
        setTimeout(function() {
            newGame = cfg;
            game.restart(startCallback);
            restarting = false;
        }, 30 * 1000);
    }
};

playerInGroup = function(player, groups) {
    // check for all group rights
    var dbUser = userDB.getByName(player);
    return groups.indexOf(dbUser.group) !== -1;
};

changeGroup = function(player, user, newGroup, force) {
    var dbUser = userDB.getByName(user);
    if (dbUser.group !== newGroup) {
        if (force || (dbUser.group !== 'admin')) {
            // do db changes
            var oldGroup = dbUser.group;
            dbUser.group = newGroup;
            userDB.save();
            // do in game changes
            // clear old group
            game.command('scoreboard players set', user, oldGroup + ' 0');
            game.command('scoreboard players set', user, dbUser.group + ' 1');
            Utils.tellAchievement(game, user, dbUser.group.toUpperCase());
        } else {
            if (player) {
                game.tellError(player, 'Cannot change administrator player group.');
            }
        }
    } else {
        if (player) {
            game.tellError(player, 'The player already in that group.');
        }
    }
};

getBannedDB = function(forceUpdate) {
    if (forceUpdate || (typeof bannedDB === 'undefined')) {
        bannedDB = JSON.parse(fs.readFileSync(config.path + 'banned-players.json', 'utf8'));
    }
    return bannedDB;
};

// declare commands
var commands = {
    version: {
        groups: allGroups,
        handler: function(player) {
            game.tellRaw(player, [{
                    text: 'Wrapper version: ',
                    color: 'white'
                }, {
                    text: '1.0',
                    color: 'green'
                }]);
        }
    },
    help: {
        groups: allGroups,
        handler: function(player) {
            // write genral info
            config.help.forEach(function(item) {
                game.tellRaw(player, item);
            });
            // add commands
            for (var cmd in commands) {
                if (commands.hasOwnProperty(cmd) && commands[cmd].text && playerInGroup(player, commands[cmd].groups)) {
                    var cmdText = '.' + cmd;
                    if (commands[cmd].args) {
                        cmdText += ' ' + commands[cmd].args;
                    }
                    game.tellRaw(player, [{
                            text: cmdText,
                            color: 'yellow',
                            clickEvent: {
                                action: 'suggest_command',
                                value: cmdText
                            }
                        }, {
                            text: ' - ' + commands[cmd].text,
                            color: 'white'
                        }]);
                }
            }
        }
    },
    rules: {
        groups: allGroups,
        text: 'Show the rules.',
        handler: function(player) {
            config.rules.forEach(function(item) {
                game.tellRaw(player, item);
            });
        }
    },
    spawn: {
        groups: allGroups,
        text: 'Teleport to spawn.',
        handler: function(player) {
            game.tellRaw(player, [{text: 'Teleporting in 5 seconds...', color: 'white'}]);
            setTimeout(function() {
                game.command('effect', player, 'clear');
                game.command('spawnpoint', player, currentGame.spawn);
                game.command('tp', player, currentGame.spawn);
                game.command('clear', player);
                // game.command('scoreboard players set', player, 'player_kills 0');
                game.command('scoreboard players set', player, 'kit 0');
                game.command('scoreboard players set', player, 'resistance 0');
                game.command('scoreboard players set', player, 'swordsman 0');
                game.command('scoreboard players set', player, 'archer 0');
                game.command('scoreboard players set', player, 'assassin 0');
            }, 5 * 1000);
        }
    },
    tpa: {
        groups: allGroups,
        args: '<player>',
        text: 'Request to teleport to <player>.',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    requests[player] = {
                        player: extra,
                        tp_to: true
                    };
                    game.tellRaw(player, [{text: 'Request sent to ' + extra + '.', color: 'white'}]);
                    game.tellRaw(extra, [{
                            text: player + ' wants to teleport to you. ',
                            color: 'white'
                        }, {
                            text: 'Accept',
                            color: "yellow",
                            clickEvent: {
                                action: "suggest_command",
                                value: ".tpyes " + player
                            }
                        }]);
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .tpa <player>', color: 'white'}]);
            }
        }
    },
    tpahere: {
        groups: allGroups,
        args: '<player>',
        text: 'Ask <player> to tp to you.',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    requests[player] = {
                        player: extra,
                        tp_to: false
                    };
                    game.tellRaw(player, [{text: 'Request sent to ' + extra + '.', color: 'white'}]);
                    game.tellRaw(extra, [{
                            text: player + ' wants to teleport you. ',
                            color: 'white'
                        }, {
                            text: 'Accept',
                            color: "yellow",
                            clickEvent: {
                                action: "suggest_command",
                                value: ".tpyes " + player
                            }
                        }]);
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .tpahere <player>', color: 'white'}]);
            }
        }
    },
    tpyes: {
        groups: allGroups,
        args: '<player>',
        text: 'Accept a teleport request.',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    var req = requests[extra];
                    if (req) {
                        if (req.tp_to) {
                            game.tellRaw(extra, [{text: 'Teleporting in 5 seconds...', color: 'white'}]);
                            setTimeout(function() {
                                game.command('tp', extra, player);
                            }, 5 * 1000);
                        } else {
                            game.tellRaw(player, [{text: 'Teleporting in 5 seconds...', color: 'white'}]);
                            setTimeout(function() {
                                game.command('tp', player, extra);
                            }, 5 * 1000);
                        }
                    }
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .tpyes <player>', color: 'white'}]);
            }
        }
    },
    restart: {
        groups: ['admin'],
        text: 'Restart the server.',
        args: '[<game name>]',
        handler: function(player, extra) {
            if (extra) {
                extra = extra.toLowerCase();
                if (extra === 'off') {
                    if (restartTimeout) {
                        clearTimeout(restartTimeout);
                        restartTimeout = undefined;
                        game.tellRaw(player, [{
                                text: 'Turning off automatic restart. Use ',
                                color: 'white'
                            }, {
                                text: '.restart',
                                color: 'yellow',
                                clickEvent: {
                                    action: 'suggest_command',
                                    value: '.restart'
                                }
                            }, {
                                text: ' for manual restart.',
                                color: 'white'
                            }]);
                    } else {
                        game.tellError(player, 'Restart is already off.');
                    }
                } else {
                    var res = config.games.every(function(item) {
                        if (item.name.toLowerCase() === extra) {
                            restart(game, item);
                            return false;
                        } else
                            return true;
                    });
                    if (res) {
                        game.tellError(player, 'Game <' + extra + '> is not found.');
                    }
                }
            } else
                restart(game);
        }
    },
    vip: {
        groups: ['admin'],
        text: 'Make <player> a VIP.',
        args: '<player>',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    changeGroup(player, extra, 'vip');
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .vip <player>', color: 'white'}]);
            }
        }
    },
    mod: {
        groups: ['admin'],
        text: 'Make <player> a moderator.',
        args: '<player>',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    changeGroup(player, extra, 'mod');
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .mod <player>', color: 'white'}]);
            }
        }
    },
    demote: {
        groups: ['admin'],
        text: 'Remove <player> from all groups.',
        args: '<player>',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    changeGroup(player, extra, 'default');
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .demote <player>', color: 'white'}]);
            }
        }
    },
    kick: {
        groups: ['mod', 'admin'],
        text: 'Kick <player> with a <reason>.',
        args: '<player> [reason]',
        handler: function(player, extra) {
            if (extra) {
                var spaceIndex = extra.indexOf(' '), user, reason;
                if (spaceIndex !== -1) {
                    user = extra.substr(0, spaceIndex);
                    reason = extra.substr(spaceIndex + 1, extra.length - spaceIndex);
                } else {
                    user = extra;
                }
                if (game.players.indexOf(user) !== -1) {
                    if (userDB.getByName(user).group !== 'admin') {
                        game.command('kick', user, reason);
                    } else {
                        game.tellError(player, 'Cannot kick an admin.');
                    }
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .kick <player> [<reason>]', color: 'white'}]);
            }
        }
    },
    ban: {
        groups: ['mod', 'admin'],
        text: 'Ban <player> with a <reason>.',
        args: '<player> [reason]',
        handler: function(player, extra) {
            if (extra) {
                var spaceIndex = extra.indexOf(' '), user, reason;
                if (spaceIndex !== -1) {
                    user = extra.substr(0, spaceIndex);
                    reason = extra.substr(spaceIndex + 1, extra.length - spaceIndex);
                } else {
                    user = extra;
                }
                if (game.players.indexOf(user) !== -1) {
                    if (userDB.getByName(user).group !== 'admin') {
                        game.command('ban', user, reason);
                    } else {
                        game.tellError(player, 'Cannot ban an admin.');
                    }
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .ban <player> [<reason>]', color: 'white'}]);
            }
        }
    },
    game: {
        groups: allGroups,
        text: 'Game commands.',
        args: 'list|change|vote <game index>',
        handler: function(player, extra) {
            if (extra) {
                extra = extra.toLowerCase().split(' ');
                switch (extra[0]) {
                    case 'list':
                        game.tellRaw(player, [{text: 'List of available games:', color: 'white'}]);
                        config.games.forEach(function(item, index) {
                            game.tellRaw(player, [{
                                    text: '' + (index + 1) + '. ',
                                    color: 'white'
                                }, {
                                    text: item.name,
                                    color: item.color || 'white'
                                }]);
                        });
                        break;
                    case 'change':
                        var tellTarget = player;
                        if (!gameVotes.active) {

                            var diff = (5 * 60 * 1000) - (Date.now() - gameVotes.time);

                            if (diff > 0) {
                                game.tellError(player, 'Game change is disabled for ' + Math.round(diff / 1000) + ' seconds.');
                                break;
                            }

                            gameVotes.active = true;
                            tellTarget = '@a';
                            // 1 minute vote timeout
                            setTimeout(function() {
                                // calculate game which wins the votes
                                var scores = [0];
                                config.games.forEach(function() {
                                    scores.push(0);
                                });
                                var votes = gameVotes.votes;
                                for (var vote in votes) {
                                    if (votes.hasOwnProperty(vote) && game.players.indexOf(vote) !== -1) {
                                        switch (userDB.getByName(vote).group) {
                                            case 'vip':
                                                scores[votes[vote]] += 2; // vips have 2 votes
                                                break;
                                            case 'mod':
                                                scores[votes[vote]] += 3; // vips have 3 votes
                                                break;
                                            case 'admin':
                                                scores[votes[vote]] += 20; // admins have 20 votes
                                                break;
                                            default:
                                                scores[votes[vote]]++;
                                        }
                                    }
                                }
                                var wonGame = 0, maxScore = scores[0];
                                for (var i = 1; i <= config.games.length; i++) {
                                    if (scores[i] > maxScore) {
                                        wonGame = i;
                                        maxScore = scores[i];
                                    } else if (scores[i] === maxScore) {
                                        wonGame = -1;
                                    }
                                }

                                game.tellRaw('@a', [{text: 'Voting is finished. Results:', color: 'white'}]);
                                game.tellRaw('@a', [{
                                        text: '0. Stay in the current game - ',
                                        color: 'white'
                                    }, {
                                        text: scores[0],
                                        color: (scores[0] === maxScore) ? 'gold' : 'white',
                                        bold: (scores[0] === maxScore)
                                    }, {
                                        text: ' votes.',
                                        color: 'white'
                                    }]);
                                config.games.forEach(function(item, index) {
                                    game.tellRaw('@a', [{
                                            text: '' + (index + 1) + '. ',
                                            color: 'white'
                                        }, {
                                            text: item.name,
                                            color: item.color || 'white'
                                        }, {
                                            text: ' - ',
                                            color: 'white'
                                        }, {
                                            text: scores[index + 1],
                                            color: (scores[index + 1] === maxScore) ? 'gold' : 'white',
                                            bold: (scores[index + 1] === maxScore)
                                        }, {
                                            text: ' votes.',
                                            color: 'white'
                                        }]);
                                });
                                if (wonGame === 0) {
                                    game.tellRaw('@a', [{text: 'Current game won.', color: 'white'}]);
                                    gameVotes = {
                                        active: false,
                                        time: Date.now(),
                                        votes: {}
                                    };
                                } else if (wonGame === -1) {
                                    game.tellRaw('@a', [{text: 'No game won.', color: 'white'}]);
                                    gameVotes = {
                                        active: false,
                                        time: Date.now(),
                                        votes: {}
                                    };
                                } else {
                                    game.tellRaw('@a', [{
                                            text: 'Now changing to ',
                                            color: 'white'
                                        }, {
                                            text: config.games[wonGame - 1].name,
                                            color: config.games[wonGame - 1].color || 'white'

                                        }]);
                                    restart(game, config.games[wonGame - 1]);
                                }
                            }, 60 * 1000);
                        }
                        game.tellRaw(tellTarget, [{
                                text: 'Game vote is started. Use ',
                                color: 'white'
                            }, {
                                text: '.game vote <game index>',
                                color: 'yellow',
                                clickEvent: {
                                    action: 'suggest_command',
                                    value: '.game vote <game index>'
                                }
                            }, {
                                text: ' to vote.',
                                color: 'white'
                            }]);
                        game.tellRaw(tellTarget, [{
                                text: '0. Stay in the current game.',
                                color: 'yellow',
                                clickEvent: {
                                    action: 'suggest_command',
                                    value: '.game vote 0'
                                }}]);
                        config.games.forEach(function(item, index) {
                            game.tellRaw(tellTarget, [{
                                    text: '' + (index + 1) + '. ' + item.name,
                                    color: 'yellow',
                                    clickEvent: {
                                        action: 'suggest_command',
                                        value: '.game vote ' + (index + 1)
                                    }}]);
                        });
                        break;
                    case 'vote':
                        if (extra[1] && !isNaN(extra[1])) {
                            if (gameVotes.active) {
                                var gameIndex = parseInt(extra[1], 10);
                                if (gameIndex === 0) {
                                    gameVotes.votes[player] = gameIndex;
                                    game.tellRaw(player, [{text: 'Accepted vote for current game', color: 'white'}]);
                                } else if ((gameIndex > config.games.length) || (gameIndex < 0)) {
                                    game.tellError(player, 'No such game.');
                                } else {
                                    gameVotes.votes[player] = gameIndex;
                                    game.tellRaw(player, [{
                                            text: 'Accepted vote for ',
                                            color: 'white'
                                        }, {
                                            text: config.games[gameIndex - 1].name,
                                            color: config.games[gameIndex - 1].color || 'white'
                                        }]);
                                }
                            } else {
                                game.tellRaw(player, [{
                                        text: 'Start the voting first by ',
                                        color: 'white'
                                    }, {
                                        text: '.game change',
                                        color: 'yellow',
                                        clickEvent: {
                                            action: 'suggest_command',
                                            value: '.game change'
                                        }
                                    }]);
                            }
                        } else {
                            game.tellRaw(player, [{text: 'Usage: .game vote <game index>', color: 'white'}]);
                        }
                        break;
                    default:
                        game.tellRaw(player, [{text: 'Usage: .game change', color: 'white'}]);
                        game.tellRaw(player, [{text: '       .game list', color: 'white'}]);
                        game.tellRaw(player, [{text: '       .game vote <game index>', color: 'white'}]);
                        break;
                }
            } else {
                game.tellRaw(player, [{text: 'Usage: .game change', color: 'white'}]);
                game.tellRaw(player, [{text: '       .game list', color: 'white'}]);
                game.tellRaw(player, [{text: '       .game vote <game index>', color: 'white'}]);
            }
        }
    },
    status: {
        groups: ['admin'],
        text: 'Show player/players status.',
        args: '[<player>]',
        handler: function(player, extra) {
            if (extra) {
                if (game.players.indexOf(extra) !== -1) {
                    var dbUser = userDB.getByName(extra);
                    game.tellRaw(player, [{
                            text: 'UUID: ' + dbUser.UUID,
                            color: 'white'
                        }]);
                    game.tellRaw(player, [{
                            text: 'group: ' + dbUser.group,
                            color: 'white'
                        }]);
                    game.tellRaw(player, [{
                            text: 'sources: [' + dbUser.sources.join(', ') + ']',
                            color: 'white'
                        }]);
                    game.tellRaw(player, [{
                            text: 'spam score: ' + dbUser.spamScore,
                            color: 'white'
                        }]);
                    game.tellRaw(player, [{
                            text: 'cheat score: ' + dbUser.cheatScore,
                            color: 'white'
                        }]);
                } else {
                    game.tellError(player, 'That player cannot be found.');
                }
            } else {
                // common server status
                var groups = {}, cheaters = [], user;
                allGroups.forEach(function(item) {
                    groups[item] = 0;
                });
                game.players.forEach(function(item) {
                    user = userDB.getByName(item);
                    groups[user.group]++;
                    if (user.cheatScore > 0) {
                        cheaters.push(item);
                    }
                });
                var grText = [];
                for (var gr in groups) {
                    if (groups.hasOwnProperty(gr)) {
                        grText.push(gr + ': ' + groups[gr]);
                    }
                }
                game.tellRaw(player, [{
                        text: 'online players: ' + game.players.length,
                        color: 'white'
                    }]);
                game.tellRaw(player, [{
                        text: 'groups: ' + grText.join(', '),
                        color: 'white'
                    }]);
                game.tellRaw(player, [{
                        text: 'cheaters: ' + cheaters.join(', '),
                        color: 'white'
                    }]);
            }
        }
    },
    sync: {
        groups: ['mod', 'admin'],
        text: 'Synchronize players.',
        handler: function(player) {
            var query = new Query('localhost', serverProps['query.port']);
            query.connect(function(err) {
                if (err) {
                    console.error('Query error: ', colors.red(err));
                }
                else {
                    query.full_stat(function(err, stat) {
                        if (err) {
                            console.error('Query statistics error:' + colors.red(err));
                        }
                        else {
                            game.players = stat.player_;
                            game.tellRaw(player, [{text: 'Successfully synchronized players.', color: 'white'}]);
                        }
                        query.close();
                    });
                }
            });
        }
    }
};

// connect our handlers to game events
game.on('joined', function(player, opts) {

    game.tellRaw(player, [{
            text: 'Welcome to ',
            color: 'white'
        }, {
            text: currentGame.name,
            color: currentGame.color || 'white'
        }]);

    var dbUser = userDB.getByName(player);
    // restore group
    game.command('scoreboard', 'players set ' + player + ' ' + dbUser.group + ' 1');
    // check sources
    var pattern = /^\/(.+):(\d+)$/, match = opts.source.match(pattern);
    if (match) {
        var source = match[1];
        if (dbUser.sources.indexOf(source) === -1) {
            dbUser.sources.push(source);
            userDB.save();
        }
        // check if users from this ip were banned and inform admins
        var userList = userDB.getUsersWithSource(source, 'UUID');
        if (userList.length > 0) {
            var bannedList = [];
            // we found other names of our user. let's check if they have bans
            getBannedDB().forEach(function(item) {
                if (userList.indexOf(item.uuid)) {
                    bannedList.push(item.name);
                }
            });
            if (bannedList.length > 0) {
                game.tellRaw('@a[score_admin_min=1]', [{
                        text: 'Possible banned alts of ',
                        color: 'gold'
                    }, {
                        text: player,
                        color: 'yellow',
                        clickEvent: {
                            action: 'suggest_command',
                            value: '/ban ' + player + ' Ban alternative account.'
                        }
                    }, {
                        text: ': ' + bannedList.join(', '),
                        color: 'gold'
                    }]);
            }
        }
    }
    return true;
});

game.on('authenticated', function(player, UUID) {
    var dbUser = userDB.getByUUID(UUID);
    if (dbUser.name !== player) {
        dbUser.name = player;
        userDB.save();
    }
    // check for slots
    if (config.reserveSlots) {
        if ((dbUser.group === 'default') && ((Date.now() - lastSlotFailTime) < 10000)) {
            // don't allow default player to join while if VIP failed
            game.command('kick', player, 'The server is full!');
        } else
        if ((dbUser.group !== 'default') && (game.players.length >= serverProps['max-players'])) {
            lastSlotFailTime = Date.now();
            // we need to kick someone
            game.players.every(function(item) {
                var user = userDB.getByName(item);
                if (user.group === 'default') {
                    game.command('kick', item, 'You have been kicked to make a room for a VIP!');
                    return false;
                } else
                    return true;
            });
        }
    }
});

game.on('banned', function(source, player) {
    var dbUser = userDB.getByName(player);
    var nonBanned = getBannedDB().every(function(item) {
        return (item.uuid !== dbUser.UUID);
    });
    if (nonBanned) {
        // inform the auditory
        Utils.tellAchievement(game, player, 'Banhammered');
    }
    // update cache
    bannedDB = getBannedDB(true);
});

game.on('unbanned', function() {
    // update cache
    bannedDB = getBannedDB(true);
});

game.on('opped', function(source, player) {
    changeGroup(source, player, 'admin', true);
});

game.on('deopped', function(source, player) {
    changeGroup(source, player, 'default', true);
});

game.on('log', function(meta) {
    // output to console log
    if (meta.source) {
        console.log('[' + meta.datetime + '] [' + meta.source + '/' + meta.level + '] ' + meta.text);
    } else {
        console.log(colors.red(meta.text));
    }
    if (meta && meta.text) {
        switch (meta.level) {
            case 'INFO':
                if (meta.source === 'Server thread') {
                    // check if it is a user message
                    var pattern = /^<(.+)>\s(\.)?([\w]+)\s*(.+)?$/,
                            match = meta.text.match(pattern);
                    if (match) {
                        var player = game.removeFormatting(match[1]), dbUser = userDB.getByName(player);
                        var curTime = Date.now();
                        if (curTime - dbUser.lastMessageTime <= 1500) {
                            dbUser.spamScore++;
                            if (dbUser.spamScore >= 10) {
                                if (playerInGroup(player, ['mod', 'admin'])) {
                                    game.tellRaw(player, [{text: 'Don\'t spam!', color: 'white'}]);
                                } else {
                                    game.command('ban', player, 'Automatic ban for spamming.');
                                }
                            }
                        } else {
                            dbUser.spamScore = 0;
                        }
                        dbUser.lastMessageTime = curTime;
                        // check if it is a command
                        if (match[2] === '.') {
                            if (restarting) {
                                game.tellError(player, 'Commands are not available during the restart time.');
                                return true;
                            }
                            var cmd = match[3].toLowerCase(), command = commands[cmd];
                            if (command && playerInGroup(player, command.groups)) {
                                command.handler(player, match[4]);
                            } else {
                                game.tellError(player, 'Unknown command.');
                            }
                        }
                    }
                }
                break;
            case 'WARN':
                // anti cheat protection
                var cheats = [
                    {pattern: /^(\w+) moved wrongly\!$/, score: 1},
                    {pattern: /^(\w+) was kicked for floating too long\!$/, score: 3}
                ];
                cheats.every(function(item) {
                    var match = meta.text.match(item.pattern);
                    if (match) {
                        //Utils.tellError(game, match[0], 'I know you are cheating.');
                        var player = match[1], dbUser = userDB.getByName(player);
                        var curDate = new Date();
                        curDate.setHours(0, 0, 0, 0);
                        if (dbUser.lastCheatDate === curDate.valueOf()) {
                            dbUser.cheatScore += item.score;
                        } else {
                            dbUser.lastCheatDate = curDate.valueOf();
                            dbUser.cheatScore = item.score;
                        }
                        game.tellRaw('@a[score_admin_min=1]', [{
                                text: player,
                                color: 'yellow',
                                clickEvent: {
                                    action: 'suggest_command',
                                    value: '/ban ' + player + ' Ban for cheating.'
                                }
                            }, {
                                text: ' cheat score = ' + dbUser.cheatScore,
                                color: 'gold'
                            }]);
                        userDB.save();
                        if (dbUser.cheatScore >= 15) {
                            if (playerInGroup(player, ['mod', 'admin'])) {
                                game.tellRaw(player, [{text: 'Don\'t cheat!', color: 'white'}]);
                            } else {
                                game.command('ban', player, 'Automatic ban for cheating.');
                            }
                        }
                        return false;
                    } else
                        return true;
                });
                break;
        }
    }
    return true;
});

game.on('start', function() {
    // choose new game either by random or by .restart request
    if (typeof newGame === 'undefined') {
        var rnd = Math.floor(Math.random() * (config.games.length - 1));
        if (currentGame && (config.games[rnd].name === currentGame.name)) {
            rnd++;
        }
        if (rnd >= config.games.length) {
            rnd--;
        }
        newGame = config.games[rnd];
    }
    currentGame = newGame;
    // rewrite reset files
    console.log(colors.green('Restoring ' + currentGame.name + ' files'));
    Utils.copyDirectory(__dirname + '/backup/' + currentGame.path, config.path + config.world);
    // load user database
    userDB.load();
    // initialize variables
    bannedDB = undefined;
    serverProps = Properties.parse(fs.readFileSync(config.path + 'server.properties', 'utf8'));
    requests = {};
    gameVotes = {
        active: false,
        time: Date.now(),
        votes: {}
    };
    lastSlotFailTime = 0;
});

game.on('started', function() {
    // create a tips timeout
    if (config.tipsInterval) {
        tipsInterval = setInterval(function() {
            var tips = currentGame.tips || config.tips;
            if (tips) {
                tips.forEach(function(item) {
                    game.tellRaw('@a', item);
                });
            }
        }, config.tipsInterval);
    }
    // add user group objectives
    allGroups.forEach(function(item) {
        game.command('scoreboard', 'objectives add ' + item + ' dummy');
    });
});

game.on('stopped', function() {
    userDB.save();
});

// start the game
game.start(startCallback);

// reading and processing console input
process.stdin.setEncoding('utf8');
process.stdin.on('readable', function() {
    var chunk = process.stdin.read();
    if (chunk !== null) {
        if (game.status === 'Running') {
            game.command(chunk.trim());
        } else {
            console.log('Game is not running now.'.red);
        }
    }
});
