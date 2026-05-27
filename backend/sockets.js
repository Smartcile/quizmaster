// Singleton that holds the Socket.io server instance.
// Created to avoid circular requires: server.js → controllers → server.js.
// Usage:
//   server.js: setIo(io) once after creating the Server
//   controllers: const { getIo } = require('../sockets'); getIo()?.to(room).emit(...)

let _io = null;

function setIo(io) { _io = io; }
function getIo()   { return _io; }

module.exports = { setIo, getIo };
