import { describe, test } from "node:test";
import { getTestInviteManager, getTestnetHyperswarm } from "../../utils.js";
import {string} from 'compact-encoding/index.js'

describe("Invite Manager - end to end", () => {

    test("Invite acceptance", async () => {
        const testHyperswarm = await getTestnetHyperswarm();

        const inviteManager = getTestInviteManager(
            testHyperswarm,
            'test',
            'inviterDb',
            string,
            string
        );


    })

})

