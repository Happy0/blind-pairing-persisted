import type { InviteDatabase } from "./database/invite-database.js";
import type { InviteUpdateHandler } from "./invite-update-handler.js";

export class InviteManager<Payload> {

    private inviteUpdateHandler: InviteUpdateHandler<Payload>;
    private inviteDatabase: InviteDatabase<Payload>;

    constructor(inviteDatabase: InviteDatabase<Payload>, inviteUpdateHandler: InviteUpdateHandler<Payload>) {
        this.inviteUpdateHandler = inviteUpdateHandler;
        this.inviteDatabase = inviteDatabase;
    }

}