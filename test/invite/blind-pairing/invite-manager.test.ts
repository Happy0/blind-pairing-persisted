import { expect, test, describe } from 'vitest'
import { createTestManagerAndDb, getTestnetHyperswarm } from "../../utils.js";
import {string} from 'compact-encoding/index.js'
import { tmpdir } from "node:os";
import path from "node:path";
import Corestore from "corestore";
import { InviteManager, type Invite } from '../../../src/invite/blind-pairing/invite-manager.js';
import type { InternalInboundInvite } from '../../../src/invite/blind-pairing/database/model/invite-model.js';

describe("Invite Manager - end to end", () => {

    const testCorestore = new Corestore(tmpdir() + path.sep + 'blind-pairing-tests');

    // test("Invites can be created and stored", async () => {
    //     const testHyperswarm = await getTestnetHyperswarm();

    //     const { inviteManager, db} = await createTestManagerAndDb(
    //         testCorestore,
    //         'test',
    //         'inviterDb',
    //         string,
    //         string
    //     );

    //     const inviterCorestore = await testCorestore.get({
    //         name: 'inviter_corestore'
    //     })

    //     await inviterCorestore.ready();

    //     const invite = await inviteManager.createInvite(inviterCorestore.key, 1, null, 'testAdditionalData');

    //     const dbEntry = await db.getInvite(invite.inviteId);

    //     expect(dbEntry).toBeDefined();

    //     await inviteManager.close()
    // })

    test("Invites can be redeemed", {timeout: 120000}, async () => {

        const inviter = await createTestManagerAndDb(
            testCorestore,
            'test',
            'inviterDb',
            string,
            string
        );

        const invitee = await createTestManagerAndDb(
            testCorestore,
            'test',
            'inviteeDb',
            string,
            string
        );

        await inviter.inviteManager.ready();
        await invitee.inviteManager.ready()

        const inviterCorestore = await testCorestore.get({
            name: 'inviter_corestore'
        })

        const inviteeCorestore = await testCorestore.get({
            name: 'invitee_corestore'
        })

        await inviterCorestore.ready();

        const invite = await inviter.inviteManager.createInvite(inviterCorestore.key, 1, null, 'testAdditionalData');
        const dbEntry = await inviter.db.getInvite(invite.inviteId);

        expect(dbEntry).toBeDefined();

        const result = new Promise<{invite: InternalInboundInvite<string>, key: Uint8Array, payload: string}>((resolve, reject) => {
            invitee.inviteManager.events.once('inviteConfirmed', (invite, key, payload) => {
                resolve({invite, key, payload})
            })

            invitee.inviteManager.events.once('inviteRejected', () => reject())
        })

        await invitee.inviteManager.useInvite({invite: invite.invite, purpose: invite.purpose}, 'testaroonie_invitee');

        const received = await result;

        expect(received.key).toStrictEqual(inviterCorestore.key);
    })

})

