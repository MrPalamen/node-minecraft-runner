var fs = require("fs");

function UserDB(dir) {
    this.fileName = dir + '/users.json';
}

UserDB.prototype = {
    fileName: undefined,
    data: [],
    load: function() {
        if (fs.existsSync(this.fileName)) {
            this.data = JSON.parse(fs.readFileSync(this.fileName, 'utf8'));
        }

    },
    save: function() {
        fs.writeFileSync(this.fileName, JSON.stringify(this.data), 'utf8');
    },
    createUser: function() {
        return {
            UUID: '',
            name: '',
            group: 'default',
            sources: [],
            lastMessageTime: 0,
            lastCheatDate: 0,
            spamScore: 0,
            cheatScore: 0
        };
    },
    getByName: function(name) {
        var user;
        this.data.every(function(item) {
            if (item.name === name) {
                user = item;
                return false;
            } else
                return true;
        });
        if (typeof user === 'undefined') {
            user = this.createUser();
            user.name = name;
            this.data.push(user);
        }
        return user;
    },
    getByUUID: function(UUID) {
        var user;
        this.data.every(function(item) {
            if (item.UUID === UUID) {
                user = item;
                return false;
            } else
                return true;
        });
        if (typeof user === 'undefined') {
            user = this.createUser();
            user.UUID = UUID;
            this.data.push(user);
        }
        return user;
    },
    each: function(fn) {
        this.data.forEach(fn);
    },
    getUsersWithSource: function(source, propName) {
        var res = [];
        this.each(function(item) {
            if (item.sources.indexOf(source)) {
                if (typeof propName === 'undefined')
                    res.push(item);
                else
                    res.push(item[propName]);
            }
        });
        return res;
    }
};

module.exports = UserDB;