/* --- Constants --- */
const REDIS_PORT = '6379';
const BACKEND_SOCK_PORT = 8081;
const PEER_SERVER_SOCK_PORT = 8082;
const USER_PORT = 5008;
const FOLLOW_USER = 'FollowUser';
const SEND_MESSAGE = 'SendMessage';
const UPDATE_EVENT = 'UpdateEvent';
const UPDATE_STATUS = 'UpdateStatus';
const CENTRAL_SERVER_IP = 'peernet.herokuapp.com';
const CENTRAL_SERVER_PORT = '80';
const REGISTRATION_HOST = 'http://peernet.herokuapp.com';

/* --- Modules and Settings --- */
var express = require('express');
var http = require('http');
var mp = require('./mp.js');
var app = express();
var server = http.createServer(app);
var io = require('socket.io').listen(server);
var ioClient = require('socket.io-client');
var redis = require("redis");
var redisClient = redis.createClient(REDIS_PORT, 'localhost');
var async = require('async');
var crypt = require('./crypt.js');

app.use(express.json()); // to support JSON-encoded bodies
app.use(express.urlencoded()); // to support URL-encoded bodies
app.set('view engine', 'jade');
app.set('view options', { layout: true });
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/static')); 

/* --- Helper Functions --- */

/* A constructor for User class */
function User(name, ipaddr) {
    this.name = name;
    this.ipaddr = ipaddr;
}

/* A constructor for Status class */
function Status(author, time, text) {
    this.author = author;
    this.time = time;
    this.text = text;
}

/* A constructor for Message class */
function Message(from, to, text, time) {
    this.from = from;
    this.to = to;
    this.text = text;
    this.time = time;
    this.toString = function () {
        return this.from + "+" + this.to + "+" + this.text + "+" + this.time;
    };
}

/* A constructor for Event class */
function Event(from, to, text, time) {
    this.from = from;
    this.to = to;
    this.text = text;
    this.time = time;
    this.toString = function () {
        return this.from + "+" + this.to + "+" + this.text + "+" + this.time;
    };
}

/**
 * callWhenDone: a simple synchronized callback closure
 * @author adrienjoly
 * example use:
 * var sync = callWhenDone(function () { console.log("all jobs are done!"); });
 * var endJob = function (){ console.log("one job ended"); sync(-1); };
 * for (var i=0; i<10; ++i) {
 *     sync(+1);
 *     setTimeout(endJob, Math.random()*10000); // to replace with your async function
 * }
 */
var callWhenDone = function (callback) {
    var counter = 0;
    return function (incr) {
        if (0 == (counter += incr))
            callback();
    };
};

/* get public local IP address */
function getHostIp() {
    var os = require('os');
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
        var ip;
        ifaces[dev].forEach(function (details) {
            if (details.family == 'IPv4') {
                if (details.address.substring(0, 3) != '127') {
                    ip = details.address;
                }
            }
        });
    }
    return ip;
}

/* --- Web Entry Points --- */

/* Login page */
app.get('/login', function (req, res) {
    res.render('login');
});
app.post('/login', function (req, res) {
    login(req.body.username, req.body.password, res);
});

/* Registration page */
app.get('/register', function (req, res) {
    res.render('register');
});
app.post('/register', function (req, res) {
    signup(req.body.username, req.body.email, req.body.password, res);
});

/* Export user data */
app.get('/export', function (req, res) {
    exportData(res);
});

/* Erase user data */
app.get('/erase', function (req, res) {
    eraseData(res);
});

/* Homepage, default to Status page */
app.get('/', function (req, res) {
    getStatus(function (statuses) {
        res.render('status', { 'statuses': statuses });
    });
});

/* Status page */
app.get('/status', function (req, res) {
    getStatus(function (statuses) {
        res.render('status', { 'statuses': statuses });
    });
});
app.post('/status', function (req, res) {
    multicastStatus(req.body.status);
    updateStatus(req.body.status, function (statuses) {
        res.render('status', { 'statuses': statuses } );
    });
});

/* Event page */
app.get('/events', function (req, res) {
    getEvent(function (events) {
        res.render('events', { 'events': events });
    });
});
app.post('/events', function (req, res) {
    var friends = req.body.friends;
    var event = req.body.event;
    var event = new Event(username, friends, event, (new Date()).getTime());
    multicastEvent(event);
    updateEvent(event, function (events) {
        res.render('events', { 'events': events } );
    });
});

/* Following page */
app.get('/following', function (req, res) {
    getFollowees(function (followees) {
        res.render('following', { 'followings': followees });
    });
});
app.post('/following', function (req, res) {
    var followee = req.body.followee;
    mp.send(FOLLOW_USER, followee, false, username);
    updateFollowees(followee, function (followees) {
        res.render('following', { 'followings': followees });
    })
});

/* Followers page */
app.get('/followers', function (req, res) {
    getFollowers(function (followers) {
        res.render('followers', { 'followers': followers });
    });
});

/* Messages page */
app.get('/messages', function (req, res) {
    getMessage(function (messages) {
        res.render('messages', { 'messages': messages });
    });
});
app.post('/messages', function (req, res) {
    var friend = req.body.friend;
    var message = req.body.message;
    var message = new Message(username, friend, message, (new Date()).getTime());
    mp.send(SEND_MESSAGE, friend, true, message.toString());
    updateMessage(message, function (messages) {
        res.render('messages', { 'messages': messages });
    })
});

/* --- Feature Implementations --- */

/* Login to the centralized server */
function login(username, password, res) {
    crypt.init(username);
    var loginSock = mp.getClientIO(CENTRAL_SERVER_IP, CENTRAL_SERVER_PORT);
    loginSock.emit('authenticate', username, password, getHostIp());
    loginSock.on('auth', function (data, flag) {
        if (flag == 1) {
            res.render('login_success');
        } else {
            res.render('login_fail');
        }
    });
}

/* Registration with the central server */
function signup(username, email, password, res) {
    var socket = ioClient.connect(REGISTRATION_HOST);
    socket.on('success', function (data) {
        console.log(data);
        res.render('register_success');
    });
    socket.on('fail', function (data) {
        console.log(data);
        res.render('register_fail', { 'err_str': data.message });
    });
    socket.emit('userdata', { uname: username, email: email, password: password });
}

/* Export user data */
function exportData(res) {
    redisClient.save(function (err) {
        if (!err) {
            res.render('export_success');
        } else {
            res.render('export_fail');
        }
    });
}

/* Erase user data */
function eraseData(res) {
    redisClient.flushall(function (err) {
        if (!err) {
            res.render('erase_success');
        } else {
            res.render('erase_fail');
        }
    });
}

/* Multicast status updates to followers. */
function multicastStatus(status) {
    getFollowers(function (followers) {
        for (var i in followers) {
            console.log('sending status update to' + followers[i].name);
            mp.send(UPDATE_STATUS, followers[i].name, true, username + '+' + status);
        }
    });
}

function multicastEvent(event) {
    var friends = event.to.split(',');
    for (var i in friends) {
        console.log('sending status update to' + friends[i].name);
        mp.send(UPDATE_EVENT, friends[i], true, event.toString());
    }
}

/* Users can get status from redis. */
function getStatus(fn) {
    var statuses = [];
    async.series([
            function (callback) {
                redisClient.zrevrange(status_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[0].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        statuses.push(new Status(json.author, date.toString(), json.text));
                    });
                    fn(statuses);
                }
            });
}

/* Users can update status. Statuses are stored in an ordered set in redis. */
function updateStatus(status, fn) {
    var statuses = [];
    async.series([
            function (callback) {
                var status_time = (new Date()).getTime();
                var status_json = JSON.stringify({ 'author': username, 'time': status_time, 'text': status });
                redisClient.zadd(status_key, status_time, status_json, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.zrevrange(status_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[1].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        statuses.push(new Status(json.author, date.toString(), json.text));
                    });
                    fn(statuses);
                }
            });
}

function getEvent(fn) {
    var events = [];
    async.series([
            function (callback) {
                redisClient.zrevrange(event_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[0].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        events.push(new Event(json.from, json.to, json.text, date));
                    });
                    fn(events);
                }
            });
}

function updateEvent(event, fn) {
    var events = [];
    async.series([
            function (callback) {
                var event_json = JSON.stringify({ 'from': event.from, 'to': event.to, 'text': event.text, 'time': event.time });
                redisClient.zadd(event_key, event.time, event_json, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.zrevrange(event_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[1].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        events.push(new Event(json.from, json.to, json.text, date));
                    });
                    fn(events);
                }
            });
}

function getMessage(fn) {
    var messages = [];
    async.series([
            function (callback) {
                redisClient.zrevrange(message_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[0].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        messages.push(new Message(json.from, json.to, json.text, date));
                    });
                    fn(messages);
                }
            });
}

function updateMessage(message, fn) {
    var messages = [];
    async.series([
            function (callback) {
                var message_json = JSON.stringify({ 'from': message.from, 'to': message.to, 'text': message.text, 'time': message.time });
                redisClient.zadd(message_key, message.time, message_json, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.zrevrange(message_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[1].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        messages.push(new Message(json.from, json.to, json.text, date));
                    });
                    fn(messages);
                }
            });
}

/* Users can follow other users. */
function updateFollowees(followee, fn) {
    var followees = [];
    async.series([
            function (callback) {
                redisClient.sadd(followee_key, followee, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.smembers(followee_key, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, results) {
                if (!err) {
                    results[1].forEach(function (e, i) {
                        var ipaddr = null;
                        followees.push(new User(e, ipaddr));
                    });
                    fn(followees);
                }
            });
}

/* Users can get her/his followees from local redis. */
function getFollowees(fn) {
    var followees = [];
    async.series([
            function (callback) {
                redisClient.smembers(followee_key, function (err, res) {
                    callback(err, res);
                })
            }],
            function (err, results) {
                if (!err) {
                    results[0].forEach(function (e, i) {
                        var ipaddr = null;
                        followees.push(new User(e, ipaddr));
                    });
                    fn(followees);
                }
            });
}

/* Users can get her/his followers from local redis. */
function getFollowers(fn) {
    var followers = [];
    async.series([
            function (callback) {
                redisClient.smembers(follower_key, function (err, res) {
                    callback(err, res);
                })
            }],
            function (err, results) {
                if (!err) {
                    results[0].forEach(function (e, i) {
                        var ipaddr = null;
                        followers.push(new User(e, ipaddr));
                    });
                    fn(followers);
                }
            });
}

var username = process.argv[2];
console.log('Your name is ' + username);

var backendSock = mp.getServerIO(BACKEND_SOCK_PORT);
var peerServerSock = mp.getServerIO(PEER_SERVER_SOCK_PORT);

var status_key = 'peernet:' + username + ':status';
var message_key = 'peernet:' + username + ':message';
var event_key = 'peernet:' + username + ':event';
var followee_key = 'peernet:' + username + ':followee';
var follower_key = 'peernet:' + username + ':follower';

server.listen(USER_PORT);
console.log('Listening on port ' + USER_PORT);

/* --- Socket.IO channels and events --- */
peerServerSock.on('connection', function (socket) {
    console.log("on server connection");
    socket.on(FOLLOW_USER, function (follower) {
        console.log("[" + follower + "] wants to follow me");
        redisClient.sadd(follower_key, follower);
    });
    socket.on(UPDATE_STATUS, function (msg) {
        var parsed_msg = decrypted_msg.split('+');
        var status_time = (new Date()).getTime();
        var status_json = JSON.stringify({ 'author': parsed_msg[0], 'time': status_time, 'text': parsed_msg[1] });
        console.log("received status update [" + parsed_msg[1] + "] from [" + parsed_msg[0] + "]");
        redisClient.zadd(status_key, status_time, status_json);
    });
    socket.on(SEND_MESSAGE, function (msg) {
        var decrypted_msg = crypt.decrypt(msg);
        var parsed_msg = decrypted_msg.split('+');
        var message_time = (new Date()).getTime();
        var message_json = JSON.stringify({ 'from': parsed_msg[0], 'to': parsed_msg[1], 'text': parsed_msg[2], 'time': message_time, });
        console.log("received message [" + parsed_msg[2] + "] from [" + parsed_msg[0] + "]");
        redisClient.zadd(message_key, message_time, message_json);
    });
    socket.on(UPDATE_EVENT, function (msg) {
        var decrypted_msg = crypt.decrypt(msg);
        var parsed_msg = decrypted_msg.split('+');
        var event_time = (new Date()).getTime();
        var event_json = JSON.stringify({ 'from': parsed_msg[0], 'to': parsed_msg[1],'text': parsed_msg[2], 'time': event_time, });
        console.log("received event [" + parsed_msg[2] + "] from [" + parsed_msg[0] + "]");
        redisClient.zadd(event_key, event_time, event_json);
    });
});

