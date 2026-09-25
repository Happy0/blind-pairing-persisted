import type { Codec, State } from 'compact-encoding'

export const nullCodec: Codec<null> = {
    preencode: function (state: State, value: null): void {},
    encode: function (state: State, value: null): void {},
    decode: function (state: State): null {
        return null
    },
}

export const undefinedCodec: Codec<undefined> = {
    preencode: function (state: State, value: undefined): void {
    },
    encode: function (state: State, value: undefined): void {
    },
    decode: function (state: State): undefined {
        return undefined;
    }
}
