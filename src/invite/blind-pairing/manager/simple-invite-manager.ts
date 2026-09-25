import type Hyperbee from "hyperbee";
import { InviteManager } from "./invite-manager.js";
import type { SharedBlindPairing } from "./multiplexed-blind-pairing.js";
import { nullCodec } from "../database/model/codecs.js";
import { fixed32 } from 'compact-encoding/index.js'

export class SimpleInviteManager extends InviteManager<Uint8Array, null> {

    constructor(
        sharedBlindPeering: SharedBlindPairing,
        privateHyperbee: Hyperbee,
        purpose: string
    ) {
        super(sharedBlindPeering, purpose, privateHyperbee, fixed32, nullCodec)
    }

}