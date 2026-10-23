// Isolate the server event loop and zlib scheduler from the 48 synthetic clients.
import { createRoom } from '../../server/room.mjs';
const room=createRoom({port:0,origins:['https://capacity.example'],capacity:48,adminToken:'capacity-local-only'});
const address=await room.start();process.send?.({port:address.port});
process.once('message',async message=>{if(message==='stop'){await room.close();process.exit(0);}});
process.once('disconnect',async()=>{await room.close();process.exit(0);});
