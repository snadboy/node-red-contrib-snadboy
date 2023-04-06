WebSocket = require('ws');

module.exports = function (RED) {
    console.log('SbhaNode: module.exports');

    function SbhaNode(config) {
        const node = this;
        console.log(`Creating SbhaNode instance - name: ${config.name} serverUrl: ${config.serverUrl} apiKey: ${config.apiKey}`);

        RED.nodes.createNode(this, config);

        // Save the node configuration (as defined in the .html)
        this.name = config.name;
        this.apiKey = config.apiKey;
        this.serverUrl = config.serverUrl;

        console.log(`Creating SbhaNode instance - name: ${config.name} serverUrl: ${config.serverUrl} - apiKey: ${config.apiKey}`)

        this.subscribers = {};      // List of subscribers to entity state changes
        this.entities = [];         // List of HA entities
        this.wsMsgId = 0;

        this.wsOpen();
        this.wsMessageHandler();

        this.on('close', (done) => {
            this.subscribers.forEach((node) => {
                node.status({});
            });
            done();
        });
    }

    SbhaNode.prototype.subscribe = function ({ node_id, entity_id } = {}) {
        if (!node_id) {
            console.error("Required 'node_id' argument missing");
            return false;
        }
        if (!entity_id) {
            console.error("Required 'entity_id' argument missing");
            return false;
        }

        if (!this.subscribers[node_id]) {
            this.subscribers[node_id] = [];
        }
        this.subscribers[node_id].push(entity_id);
    };

    SbhaNode.prototype.unsubscribe = function (node_id, entity_id) {
        if (!node_id) {
            console.error("Required 'node' argument missing");
            return false;
        }

        if (!entity_id) {
            this.subscribers[node_id] = [];
        } else {
            this.subscribers[node_id] = this.subscribers[subscriberNode].filter((e) => e !== entity_id);
        }

        if (this.subscribers[node_id].length === 0) {
            delete this.subscribers[node_id];
        }
    };

    SbhaNode.prototype.getEntityList = function (domain = '') {
        return this.entities.filter((e) => !domain || e.entity_id.startsWith(domain));
    };

    SbhaNode.prototype.wsOpen = function () {
        // Convert the server URL to a websocket URL
        let ha = '';
        if (this.serverUrl.startsWith('https://'))
            ha = this.
                serverUrl.replace('https://', 'wss://');
        else if (this.
            serverUrl.startsWith('http://'))
            ha = this.
                serverUrl.replace('http://', 'ws://');
        else if (this.
            serverUrl.startsWith('wss://') || serverUrl.startsWith('ws://'))
            ha = this.
                serverUrl;
        else
            ha = 'ws://' + this.
                serverUrl;
        this.wsUrl = `${ha}/api/websocket`;

        try {
            this.ws = new WebSocket(this.wsUrl);
        } catch (error) {
            console.log(`Could not connect to HA server [${serverUrl}].`, error);
        }

        this.ws.on('open', () => { });
    }

    SbhaNode.prototype.wsMsgTypes = {
        auth_required: {
            msgId: null,
            func: (sbha, msgData) => {
                const message = {
                    type: 'auth',
                    access_token: sbha.apiKey
                };
                sbha.ws.send(JSON.stringify(message));
            }
        },
        auth_invalid: {
            msgId: null,
            func: (sbha, msgData) => {
                sbha.error(`HA Response [${this.wsUrl}}]: Invalid API key.`);
                sbha.ws.close();
            }
        },
        auth_ok: {
            msgId: null,
            func: ((sbha, msgData) => {
                let message;

                // Request the list of entities
                sbha.wsMsgTypes.result.msgId = ++sbha.wsMsgId;
                message = {
                    id: sbha.wsMsgTypes.result.msgId,
                    type: 'get_states'
                }
                sbha.ws.send(JSON.stringify(message));

                // Subscribe to state change events
                sbha.wsMsgTypes.event.msgId = ++sbha.wsMsgId;
                message = {
                    id: sbha.wsMsgTypes.event.msgId,
                    type: 'subscribe_events',
                    event_type: 'state_changed'
                };
                sbha.ws.send(JSON.stringify(message));
            })
        },
        result: {
            msgId: null,
            func: ((sbha, msgData) => {
                // Store the list of entities
                sbha.entities = msgData.result.map((e) => ({
                    entity_id: e.entity_id,
                    friendly_name: e.attributes.friendly_name || '',
                    device_class: e.attributes.device_class || ''
                }));
            })
        },
        event: {
            msgId: null,
            func: ((sbha, msgData) => {
                // console.log(`HA Response [${sbha.wsUrl}}]: Event for ${msgData.event.data.entity_id} received - state: ${msgData.event.data.new_state.state}.`);

                // Forward the event to all subscribed nodes
                for (const subscriber_node_id in sbha.subscribers) {
                    if ((sbha.subscribers[subscriber_node_id] || []).includes(msgData.event.data.entity_id))
                        RED.nodes.getNode(subscriber_node_id).receive({ payload: msgData.event });
                };
            })
        }
    }

    SbhaNode.prototype.wsMessageHandler = function () {
        this.ws.on('message', (message) => {
            const msgData = JSON.parse(message);

            const onMsg = this.wsMsgTypes[msgData.type];
            if (!onMsg) {
                console.log(`HA Response [${this.wsUrl}}]: Unknown message type: ${msgData.type}`);
            } else {
                if (!onMsg.msgId || msgData.id === onMsg.msgId) {
                    onMsg.func(this, msgData);
                    return;
                }
            }
        });

    }


    RED.nodes.registerType('sbha', SbhaNode);

    RED.httpAdmin.get('/sbha/:id/getEntityList', (req, res) => resEntities(req, res));
    RED.httpAdmin.get('/sbha/:id/getEntityList/domain/:domain', (req, res) => resEntities(req, res, 'domain', (req.params.domain || '').toLowerCase()));
    RED.httpAdmin.get('/sbha/:id/getEntityList/device_class/:device_class', (req, res) => resEntities(req, res, 'device_class', (req.params.device_class || '').toLowerCase()));
    function resEntities(req, res, filterType, filterValue) {
        const sbhaNode = RED.nodes.getNode(req.params.id);
        if (!sbhaNode) {
            const msg = `sbha.getEntityList ** 404 ** sbha node '${req.params.id}' not found`;
            console.log(msg);
            res.status(404).json({ error: msg });
            return;
        }

        if (filterType === 'domain' && filterValue[-1] !== '.') {
            filterValue += '.';
        }

        let entities = sbhaNode.entities;
        if (filterType === 'domain')
            entities = sbhaNode.entities.filter((e) =>
                e.entity_id.toLowerCase().startsWith(filterValue));
        else if (filterType === 'device_class')
            entities = sbhaNode.entities.filter((e) =>
                e.device_class.toLowerCase() === filterValue);

        res.status(200).json(entities);
    }
}
