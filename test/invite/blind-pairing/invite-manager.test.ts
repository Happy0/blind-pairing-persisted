import { expect, test, describe } from 'vitest'
import { createTestManagerAndDb, getTestnetHyperswarm } from "../../utils.js";
import {string} from 'compact-encoding/index.js'
import { tmpdir } from "node:os";
import path from "node:path";
import Corestore from "corestore";

describe("Invite Manager - end to end", () => {

    const testCorestore = new Corestore(tmpdir() + path.sep + 'blind-pairing-tests');

    test("Invites can be created and stored", async () => {
        const testHyperswarm = await getTestnetHyperswarm();

        const { inviteManager, db} = await createTestManagerAndDb(
            testCorestore,
            testHyperswarm,
            'test',
            'inviterDb',
            string,
            string
        );

        const inviterCorestore = await testCorestore.get({
            name: 'inviter_corestore'
        })

        await inviterCorestore.ready();

        const invite = await inviteManager.createInvite(inviterCorestore.key, 1, null, 'testAdditionalData');

        const dbEntry = await db.getInvite(invite.inviteId);

        expect(dbEntry).toBeDefined();

    })

})

