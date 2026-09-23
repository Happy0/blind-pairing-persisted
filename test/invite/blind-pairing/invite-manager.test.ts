import { expect, test, describe, afterAll, beforeAll, type Matcher, expectTypeOf } from 'vitest'
import { createTestDependencies as createFreshTestDependencies, getTestnetHyperswarm } from "../../utils.js";
import {string} from 'compact-encoding/index.js'
import { tmpdir } from "node:os";
import path from "node:path";
import Corestore from "corestore";
import type { InternalInboundInvite, InternalOutboundInvite } from '../../../src/invite/blind-pairing/database/model/invite-model.js';
import { randomBytes } from 'node:crypto';
import fs from 'fs';
import { fail } from 'node:assert';

describe("Invite Manager - end to end", () => {

    const testDataDir = tmpdir() + path.sep + 'blind-pairing-tests';

    const testCorestore = new Corestore(tmpdir() + path.sep + 'blind-pairing-tests');


    afterAll(async () => {
        await testCorestore.close();

        fs.rm(testDataDir, () => {});
    })

    test("Invites can be created and stored", async () => {

        const { inviteManager, db } = await createFreshTestDependencies(
            testCorestore,
            'test',
            string,
            string
        );

        const inviterCorestore = await testCorestore.namespace(randomBytes(10).toString('hex')).get({
            name: 'inviter_corestore'
        })

        await inviterCorestore.ready();

        const invite = await inviteManager.createInvite(inviterCorestore.key, 1, null, 'testAdditionalData');

        const dbEntry = await db.getInvite(invite.inviteId);

        expect(dbEntry).toBeDefined();
    })

    test("Invites being redeemed reduces remaining count", {timeout: 120000}, async () => {

        const inviter = await createFreshTestDependencies(
            testCorestore,
            'test',
            string,
            string
        );

        const invitee = await createFreshTestDependencies(
            testCorestore,
            'test',
            string,
            string
        );

        await inviter.inviteManager.ready();
        await invitee.inviteManager.ready()

        const inviterCorestore = await testCorestore.namespace(randomBytes(10).toString('hex')).get({
            name: 'inviter_corestore'
        })

        const inviteeCorestore = await testCorestore.namespace(randomBytes(10).toString('hex')).get({
            name: 'invitee_corestore'
        })

        await inviterCorestore.ready();
        await inviteeCorestore.ready();

        const invite = await inviter.inviteManager.createInvite(inviterCorestore.key, 1, null, 'testAdditionalData');
        const dbEntry = await inviter.db.getInvite(invite.inviteId);

        expect(dbEntry).toBeDefined();

        const result = new Promise<{invite: InternalInboundInvite<string>, key: Uint8Array, payload: string}>((resolve, reject) => {
            invitee.inviteManager.events.once('inviteConfirmed', (invite, key, payload) => {
                resolve({invite, key, payload})
            })

            invitee.inviteManager.events.once('inviteRejected', () => reject())
        })

        await invitee.inviteManager.useInvite({invite: invite.invite, purpose: invite.purpose}, 'invitee_payload');

        const received = await result;

        expect(received.key).toStrictEqual(inviterCorestore.key);
        expect(received.payload).toStrictEqual('testAdditionalData');

        const newInviteState = await inviter.db.getInvite(invite.inviteId);

        expect(newInviteState).toBeDefined()
        expectOutboundInvite(invite)

        expect(invite.remaining).toStrictEqual(0);
    })

    function expectOutboundInvite<I, O>(invite: InternalInboundInvite<I> |  InternalOutboundInvite<O>): invite is InternalOutboundInvite<O> {
        if (invite.direction === 'outbound') {
            return true
        } else {
            fail('Not outbound invite as expected');
        }
    }

})

