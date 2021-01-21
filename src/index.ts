import {Server} from "@hapi/hapi";
import {getSSERegistrations, saveSSERegistrations} from "./sse";

const init = async () => {
    const server: Server = new Server({
        port: 3006,
        host: 'localhost',
        routes: {
            cors: true
        }
    });
    server.route({
        method: 'GET',
        path: '/sse',
        handler: getSSERegistrations
    });
    server.route({
        method: 'POST',
        path: '/sse',
        handler: saveSSERegistrations
    });

    await server.start();
    console.log('Server running on %s', server.info.uri);
};
process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});
init();
