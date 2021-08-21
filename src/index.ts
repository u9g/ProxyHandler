import { Client, ClientOptions, createClient, createServer, Server, ServerClient, States } from 'minecraft-protocol'
import TypedEmitter from 'typed-emitter'
import { EventEmitter } from 'events'

interface MinecraftLogin {
    username: string;
    password?: string;
    auth?: 'mojang' | 'microsoft';
}

interface ServerOptions {
    loginHandler?: (client: Client) => MinecraftLogin;
    serverOptions?: ServerOptions;
    clientOptions?: ClientOptions;
}

interface PacketMeta {
    name: string;
}

interface ProxyEvents {
    incoming: (data: any, meta: PacketMeta, toClient: Client, toServer: ServerClient) => void;
    outgoing: (data: any, meta: PacketMeta, toClient: Client, toServer: ServerClient) => void;
}

export default class ProxyHandler extends (EventEmitter as new () => TypedEmitter<ProxyEvents>) {
    options: ServerOptions;
    server?: Server

    constructor (options: ServerOptions) {
        super()
        this.options = options;
        this.server = createServer({
            'online-mode': true,
            keepAlive: false,
            ...this.options.serverOptions
        })
        this.server.on('login', client => this.onLogin(client))
    }

    onLogin (toClient: ServerClient): void {
        // until the proxyClient logs in, lets send a login packet
        toClient.write('login', {
            entityId: toClient.id,
            gameMode: 0,
            dimension: 0,
            difficulty: 1,
            maxPlayers: 20,
            levelType: 'default',
            reducedDebugInfo: false
        })

        const toServer = createClient({
            ...this.options.clientOptions,
            keepAlive: false,
            ...this.options.loginHandler(toClient)
        })

        toServer.on('login', (data) => {
            if (this.clientIsOnline(toClient)) {
              const dimension = data.dimension === 0 ? -1 : 0
              toClient.write('respawn', {
                dimension,
                difficulty: data.difficulty,
                gamemode: data.gameMode,
                levelType: data.levelType
              })
              toClient.write('respawn', {
                dimension: data.dimension,
                difficulty: data.difficulty,
                gamemode: data.gameMode,
                levelType: data.levelType
              })
            }
          })
      
          toClient.on('packet', (data, meta) => {
            if (!this.clientIsOnline(toClient)) return
            if (toServer.state === States.PLAY && meta.state === States.PLAY) {
                this.emit('outgoing', data, meta, toServer, toClient)
            }
          })
      
          toServer.on('packet', (data, meta) => {
            if (this.clientIsOnline(toClient)) return
            if (meta.name === 'disconnect') {
              toClient.write('kick_disconnect', data)
            }
            if (meta.state === States.PLAY && toClient.state === States.PLAY) {
              if (meta.name === 'set_compression') {
                toClient.compressionThreshold = data.threshold // Set compression
                return
              }
              this.emit('incoming', data, meta, toServer, toClient)
            }
          })
      
          toClient.once('end', () => this.clientEnd(toClient))
    }

    clientEnd (client: ServerClient): void {
        this.server[client.id].end()
    }

    clientIsOnline (client: ServerClient): boolean {
        return !!this.server.clients[client.id]
    }
}