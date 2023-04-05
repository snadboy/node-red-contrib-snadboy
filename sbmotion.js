module.exports = function (RED) {
    function SbMotion(config) {
        const node = this;

        RED.nodes.createNode(this, config);

        node.on('input', function (msg) {
            node.log(`Received message payload: ${msg.payload.data.new_state.entity_id} -=- ${msg.payload.data.new_state.state}`);
            node.send(msg);
        });

        if (!config.motion) {
            node.error('No motion entity id configured');
            return;
        }

        const sbhaNode = RED.nodes.getNode(config.sbhaId);
        if (!sbhaNode) {
            node.error(`sbha node, id: ${config.sbhaId}, not found`);
            return;
        }

        node.sbhaNode.subscribe({ node_id: node.id, entity_id: config.motion });

        node.on('close', function (done) {
            node.sbhaNode.unsubscribe({ node_id: node.id });
            done();
        });
    }

    RED.nodes.registerType('sbmotion', SbMotion);
};

