import Hyperswarm from "hyperswarm"
import { InviteManager } from "../src/invite/blind-pairing/invite-manager.js"
import { MultiplexedBlindPeering } from "../src/invite/blind-pairing/multiplexed-blind-peering.js";
import type { Codec } from "compact-encoding";
import { BTreeInviteDatabase } from "../src/invite/blind-pairing/database/invite-database.js";
import Corestore from "corestore";
import { tmpdir } from "node:os";
import path from "node:path";
import Hyperbee from "hyperbee";
import createTestnet from "hyperdht/testnet.js";

const corestore = new Corestore(tmpdir() + path.sep + 'blind-pairing-tests');

export async function getTestnetHyperswarm(): Promise<Hyperswarm> {
    const testnet = await createTestnet(10)
    const bootstrap = testnet.bootstrap

    const swarm = new Hyperswarm({ bootstrap })

    return swarm;
}

export async function getTestInviteManager<Inbound, Outbound extends {}>(
    testHyperswarm: Hyperswarm,
    purpose: string,
    coreName: string,
    inboundCodec: Codec<Inbound>,
    outboundCodec: Codec<Outbound>
): Promise<InviteManager<Inbound, Outbound>> {

    const mbp = new MultiplexedBlindPeering(testHyperswarm);

    await corestore.ready();
    const hypercore = corestore.get({name: coreName});
    await hypercore.ready();

    const hyperbee: Hyperbee = new Hyperbee(hypercore as any);
    await hyperbee.ready();

    const db = new BTreeInviteDatabase<Inbound,Outbound>(
        hyperbee,
        purpose,
        inboundCodec,
        outboundCodec
    )

    return new InviteManager<Inbound, Outbound>(
        mbp,
        purpose,
        db,
        inboundCodec,
        outboundCodec
    )

}