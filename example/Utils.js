var fs = require('fs-extra');

copyDirectory = function(sourcePath, targetPath) {
    var stat, files = fs.readdirSync(sourcePath);
    files.forEach(function(file) {
        var subDir = sourcePath + '/' + file;
        console.log('processing: ' + subDir);
        stat = fs.statSync(subDir);
        if (stat && stat.isDirectory()) {
            copyDirectory(subDir, targetPath + '/' + file);
        } else {
            fs.copySync(subDir, targetPath + '/' + file);
        }
    });
};

exports.tellAchievement = function(game, player, achievement) {
    game.tellRaw('@a', [{
            text: player + ' has just earned the achievement: ',
            color: 'white'
        }, {
            text: '[' + achievement.toUpperCase() + '!]',
            color: 'green'
        }]);
};

exports.copyDirectory = copyDirectory;