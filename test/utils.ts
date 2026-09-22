import Hyperswarm from "hyperswarm"
import { InviteManager } from "../src/invite/blind-pairing/invite-manager.js"
import { MultiplexedBlindPeering } from "../src/invite/blind-pairing/multiplexed-blind-peering.js";
import type { Codec } from "compact-encoding";
import { BTreeInviteDatabase, type IInviteDatabase } from "../src/invite/blind-pairing/database/invite-database.js";
import Corestore from "corestore";
import Hyperbee from "hyperbee";
import createTestnet from "hyperdht/testnet.js";

export async function getTestnetHyperswarm(): Promise<Hyperswarm> {

    const swarm = new Hyperswarm()

    return swarm;
}

export async function createTestManagerAndDb<Inbound, Outbound extends {}>(
    corestore: Corestore,
    purpose: string,
    coreName: string,
    inboundCodec: Codec<Inbound>,
    outboundCodec: Codec<Outbound>
): Promise<{inviteManager: InviteManager<Inbound, Outbound>, db: IInviteDatabase<Inbound, Outbound>}> {

    const mbp = new MultiplexedBlindPeering(await getTestnetHyperswarm());

    await corestore.ready();
    const hypercore = corestore.get({name: coreName});
    await hypercore.ready();

    const hyperbee: Hyperbee = new Hyperbee(hypercore as any, {keyEncoding: 'utf-8', valueEncoding: 'binary'});
    await hyperbee.ready();

    const db = new BTreeInviteDatabase<Inbound,Outbound>(
        hyperbee,
        purpose,
        inboundCodec,
        outboundCodec
    )

    const inviteManager = new InviteManager<Inbound, Outbound>(
        mbp,
        purpose,
        db,
        inboundCodec,
        outboundCodec
    )

    return { inviteManager, db }

}