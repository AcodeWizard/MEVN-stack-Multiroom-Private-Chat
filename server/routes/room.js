const express = require('express');
const router = express.Router();
const passport = require('passport');

const Room = require('../models/Room');
const User = require('../models/User');
const Message = require('../models/Message');

const {
    createErrorObject,
    checkCreateRoomFields
} = require('../middleware/authenticate');

/**
 * @description GET /api/room
 */
router.get('/', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    const rooms_p = Room.findAll({}, {
        raw: true
    });
    const users_p = User.findAll({}, {
        raw: true
    });

    Promise.all([rooms_p, users_p]).then((value => {
            const rooms = value[0];
            const users = value[1];
            for (var i = 0; i < rooms.length; i++) {
                const room = rooms[i];
                room['user'] = users.filter((user) => user['id'] == room['user']);
                if (room['user']) {
                    room['user'] = room['user'][0];
                }
                if (room['access'] == 1) {
                    //public room - set the number of users as room users
                    room['users'] = users.filter((user) => user['room_id'] === room['id']).length;
                } else {
                    //private room - set the number of users as all (-1 : you)
                    room['users'] = users.length - 1;
                }
            }
            if (rooms) {
                return res.status(200).json(rooms);
            } else {
                return res.status(404).json({
                    error: 'No Rooms Found'
                });
            }
        }))
        .catch(err => {
            console.log('err', err);
        });

});

/**
 * @description GET /api/room/:room_id
 */
router.get('/:room_id', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    const room = await Room.findByPk(req.params.room_id, {
        raw: true
    });
    if (room) {
        if (room['access']) {
            //public room
            await User.findAndCountAll({
                    where: {
                        room_id: room['id']
                    }
                })
                .then(result => {
                    room['users'] = result.rows;
                    return res.status(200).json(room);
                })
        } else {
            //private room
            await User.findAll({}, {
                    raw: true
                })
                .then(result => {
                    room['users'] = result;
                    return res.status(200).json(room);
                })
        }
    } else {
        return res.status(404).json({
            error: `No room with name ${req.params.room_name} found`
        });
    }
});

/**
 * @description POST /api/room
 */
router.post(
    '/',
    [passport.authenticate('jwt', {
        session: false
    }), checkCreateRoomFields],
    async (req, res) => {
        let errors = [];

        const room = await Room.findOne({
            where: {
                name: req.body.room_name
            }
        });
        if (room) {
            if (room.name === req.body.room_name) {
                errors.push({
                    param: 'room_taken',
                    msg: 'Roomname already taken'
                });
            }
            return res.json({
                errors: createErrorObject(errors)
            });
        } else {
            const newRoom = new Room({
                name: req.body.room_name,
                user: req.user.id,
                access: req.body.password ? false : true,
                password: req.body.password
            });

            newRoom
                .save()
                .then(room => {
                    User.findOne({
                            where: {
                                'id': room['user']
                            }
                        })
                        .then(user => {
                            room['user'] = user;
                        })
                        .catch(err => {
                            console.log(err);
                        })
                        .finally(() => {
                            room['users'] = 0;
                            return res.status(200).json(room);
                        });
                })
                .catch(err => {
                    return res.json(err);
                });
        }
    }
);

// /**
//  * @description POST /api/room/verify
//  */
// router.post('/verify', passport.authenticate('jwt', { session: false }), async (req, res) => {
//     if (!req.body.password === true) {
//         return res.json({
//             errors: createErrorObject([
//                 {
//                     param: 'password_required',
//                     msg: 'Password is required'
//                 }
//             ])
//         });
//     }

//     const room = await Room.findOne({ name: req.body.room_name }).exec();

//     if (room) {
//         const verified = await room.isValidPassword(req.body.password);

//         if (verified === true) {
//             room.accessIds.push(req.user.id);
//             await room.save();
//             return res.status(200).json({ success: true });
//         } else {
//             return res.json({
//                 errors: createErrorObject([
//                     {
//                         param: 'invalid_password',
//                         msg: 'Invalid Password'
//                     }
//                 ])
//             });
//         }
//     } else {
//         return res.status(404).json({ errors: `No room with name ${req.params.room_name} found` });
//     }
// });

/**
 * @description DELETE /api/room/:room_name
 */
router.delete('/:room_name', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    try {
        const room = await Room.findOne({
            where: {
                'name': req.params.room_name
            }
        }, {
            raw: true
        });
        const status = await Room.destroy({
            where: {
                'name': req.params.room_name
            }
        });
        await Message.destroy({
            where: {
                'room': room['id']
            }
        });

        if (status) {
            return res.status(200).json(room);
        } else {
            return res.status(404).json({
                errors: `No room with name ${
                    req.params.room_name
                } found, You will now be redirected`
            });
        }
    } catch (err) {
        return res.status(404).json(err);
    }
});

/**
 * @description PUT /api/room/update/name
 */
router.post('/update/name', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {
    req.check('new_room_name')
        .isString()
        .isLength({
            min: 3,
            max: 20
        })
        .withMessage('New Room Name must be between 3 and 20 characters');

    let errors = req.validationErrors();

    if (errors.length > 0) {
        return res.send({
            errors: createErrorObject(errors)
        });
    }
    const updateFields = {};

    if (req.body) {
        updateFields['name'] = req.body.new_room_name
    }
    Room.update(updateFields, {
            returning: true,
            plain: true,
            where: {
                'name': req.body.room_name
            }
        })
        .then(function (doc) {
            if (doc[1]) {
                Room.findOne({
                        where: {
                            'name': req.body.new_room_name
                        }
                    })
                    .then(async doc => {
                        await User.findAndCountAll({
                                where: {
                                    'room_id': doc['id']
                                }
                            })
                            .then(result => {
                                doc['users'] = result.rows;
                            })
                        return res.status(200).json(doc);
                    })
            }
        })
        // .then(doc => res.json({ success: true, user: doc }))
        .catch(err => {
            console.log('err', err);
            return res.status(404).json({
                errors: `Room ${req.params.room_name} update failed`
            });
        });
});

/**
 * @description PUT /api/room/remove/users
 */
router.post('/remove/users', passport.authenticate('jwt', {
    session: false
}), async (req, res) => {

    let room = await Room.findByPk(req.body.room_id, {
        raw: true
    });

    if (room) {
        const updateFields = ({
            room_id: null
        });
        await User.update(updateFields, {
                returning: true,
                raw: true,
                where: {
                    id: req.user.id
                }
            })
            .then(async info => {
                if (info[1]) {
                    const users = await User.findAll({
                        where: {
                            room_id: req.body.room_id
                        }
                    }, {
                        raw: true
                    })
                    room['users'] = users;
                }
            })
        return res.status(200).json(room);
    } else {
        return res.status(404).json({
            errors: `No room with name ${req.body.room_name} found`
        });
    }
});

/**
 * @description PUT /api/room/remove/users/:id/all
 */
router.put(
    '/remove/users/all',
    passport.authenticate('jwt', {
        session: false
    }),
    async (req, res) => {
        const updateFields = {
            'room_id': null
        }
        await User.update(updateFields, {
                returning: true,
                raw: true,
                where: {
                    id: req.body.userid
                }
            })
            .then(async info => {
                if (info[1]) {
                    const rooms_p = Room.findAll({}, {
                        raw: true
                    });
                    const users_p = User.findAll({}, {
                        raw: true
                    });

                    Promise.all([rooms_p, users_p]).then((value => {
                            const rooms = value[0];
                            const users = value[1];
                            for (var i = 0; i < rooms.length; i++) {
                                const room = rooms[i];
                                room['user'] = users.filter((user) => user['id'] == room['user']);
                                if (room['user']) {
                                    room['user'] = room['user'][0];
                                }
                                room['users'] = users.filter((user) => user['room_id'] === room['id']).length;
                            }
                            if (rooms) {
                                return res.status(200).json(rooms);
                            } else {
                                return res.status(404).json({
                                    error: 'No Rooms Found'
                                });
                            }
                        }))
                        .catch(err => {
                            console.log('err', err);
                            return res.status(404).json({
                                error: 'No Rooms Found'
                            });
                        });
                }
            });
    }
);
module.exports = router;