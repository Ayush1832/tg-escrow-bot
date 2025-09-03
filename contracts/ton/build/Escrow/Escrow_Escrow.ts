import {
    Cell,
    Slice,
    Address,
    Builder,
    beginCell,
    ComputeError,
    TupleItem,
    TupleReader,
    Dictionary,
    contractAddress,
    address,
    ContractProvider,
    Sender,
    Contract,
    ContractABI,
    ABIType,
    ABIGetter,
    ABIReceiver,
    TupleBuilder,
    DictionaryValue
} from '@ton/core';

export type DataSize = {
    $$type: 'DataSize';
    cells: bigint;
    bits: bigint;
    refs: bigint;
}

export function storeDataSize(src: DataSize) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.cells, 257);
        b_0.storeInt(src.bits, 257);
        b_0.storeInt(src.refs, 257);
    };
}

export function loadDataSize(slice: Slice) {
    const sc_0 = slice;
    const _cells = sc_0.loadIntBig(257);
    const _bits = sc_0.loadIntBig(257);
    const _refs = sc_0.loadIntBig(257);
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function loadGetterTupleDataSize(source: TupleReader) {
    const _cells = source.readBigNumber();
    const _bits = source.readBigNumber();
    const _refs = source.readBigNumber();
    return { $$type: 'DataSize' as const, cells: _cells, bits: _bits, refs: _refs };
}

export function storeTupleDataSize(source: DataSize) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.cells);
    builder.writeNumber(source.bits);
    builder.writeNumber(source.refs);
    return builder.build();
}

export function dictValueParserDataSize(): DictionaryValue<DataSize> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDataSize(src)).endCell());
        },
        parse: (src) => {
            return loadDataSize(src.loadRef().beginParse());
        }
    }
}

export type SignedBundle = {
    $$type: 'SignedBundle';
    signature: Buffer;
    signedData: Slice;
}

export function storeSignedBundle(src: SignedBundle) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBuffer(src.signature);
        b_0.storeBuilder(src.signedData.asBuilder());
    };
}

export function loadSignedBundle(slice: Slice) {
    const sc_0 = slice;
    const _signature = sc_0.loadBuffer(64);
    const _signedData = sc_0;
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function loadGetterTupleSignedBundle(source: TupleReader) {
    const _signature = source.readBuffer();
    const _signedData = source.readCell().asSlice();
    return { $$type: 'SignedBundle' as const, signature: _signature, signedData: _signedData };
}

export function storeTupleSignedBundle(source: SignedBundle) {
    const builder = new TupleBuilder();
    builder.writeBuffer(source.signature);
    builder.writeSlice(source.signedData.asCell());
    return builder.build();
}

export function dictValueParserSignedBundle(): DictionaryValue<SignedBundle> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSignedBundle(src)).endCell());
        },
        parse: (src) => {
            return loadSignedBundle(src.loadRef().beginParse());
        }
    }
}

export type StateInit = {
    $$type: 'StateInit';
    code: Cell;
    data: Cell;
}

export function storeStateInit(src: StateInit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeRef(src.code);
        b_0.storeRef(src.data);
    };
}

export function loadStateInit(slice: Slice) {
    const sc_0 = slice;
    const _code = sc_0.loadRef();
    const _data = sc_0.loadRef();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function loadGetterTupleStateInit(source: TupleReader) {
    const _code = source.readCell();
    const _data = source.readCell();
    return { $$type: 'StateInit' as const, code: _code, data: _data };
}

export function storeTupleStateInit(source: StateInit) {
    const builder = new TupleBuilder();
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    return builder.build();
}

export function dictValueParserStateInit(): DictionaryValue<StateInit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStateInit(src)).endCell());
        },
        parse: (src) => {
            return loadStateInit(src.loadRef().beginParse());
        }
    }
}

export type Context = {
    $$type: 'Context';
    bounceable: boolean;
    sender: Address;
    value: bigint;
    raw: Slice;
}

export function storeContext(src: Context) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeBit(src.bounceable);
        b_0.storeAddress(src.sender);
        b_0.storeInt(src.value, 257);
        b_0.storeRef(src.raw.asCell());
    };
}

export function loadContext(slice: Slice) {
    const sc_0 = slice;
    const _bounceable = sc_0.loadBit();
    const _sender = sc_0.loadAddress();
    const _value = sc_0.loadIntBig(257);
    const _raw = sc_0.loadRef().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function loadGetterTupleContext(source: TupleReader) {
    const _bounceable = source.readBoolean();
    const _sender = source.readAddress();
    const _value = source.readBigNumber();
    const _raw = source.readCell().asSlice();
    return { $$type: 'Context' as const, bounceable: _bounceable, sender: _sender, value: _value, raw: _raw };
}

export function storeTupleContext(source: Context) {
    const builder = new TupleBuilder();
    builder.writeBoolean(source.bounceable);
    builder.writeAddress(source.sender);
    builder.writeNumber(source.value);
    builder.writeSlice(source.raw.asCell());
    return builder.build();
}

export function dictValueParserContext(): DictionaryValue<Context> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeContext(src)).endCell());
        },
        parse: (src) => {
            return loadContext(src.loadRef().beginParse());
        }
    }
}

export type SendParameters = {
    $$type: 'SendParameters';
    mode: bigint;
    body: Cell | null;
    code: Cell | null;
    data: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeSendParameters(src: SendParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        if (src.code !== null && src.code !== undefined) { b_0.storeBit(true).storeRef(src.code); } else { b_0.storeBit(false); }
        if (src.data !== null && src.data !== undefined) { b_0.storeBit(true).storeRef(src.data); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadSendParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _code = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _data = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleSendParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _code = source.readCellOpt();
    const _data = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'SendParameters' as const, mode: _mode, body: _body, code: _code, data: _data, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleSendParameters(source: SendParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeCell(source.code);
    builder.writeCell(source.data);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserSendParameters(): DictionaryValue<SendParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeSendParameters(src)).endCell());
        },
        parse: (src) => {
            return loadSendParameters(src.loadRef().beginParse());
        }
    }
}

export type MessageParameters = {
    $$type: 'MessageParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    to: Address;
    bounce: boolean;
}

export function storeMessageParameters(src: MessageParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeAddress(src.to);
        b_0.storeBit(src.bounce);
    };
}

export function loadMessageParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _to = sc_0.loadAddress();
    const _bounce = sc_0.loadBit();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function loadGetterTupleMessageParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _to = source.readAddress();
    const _bounce = source.readBoolean();
    return { $$type: 'MessageParameters' as const, mode: _mode, body: _body, value: _value, to: _to, bounce: _bounce };
}

export function storeTupleMessageParameters(source: MessageParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeAddress(source.to);
    builder.writeBoolean(source.bounce);
    return builder.build();
}

export function dictValueParserMessageParameters(): DictionaryValue<MessageParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeMessageParameters(src)).endCell());
        },
        parse: (src) => {
            return loadMessageParameters(src.loadRef().beginParse());
        }
    }
}

export type DeployParameters = {
    $$type: 'DeployParameters';
    mode: bigint;
    body: Cell | null;
    value: bigint;
    bounce: boolean;
    init: StateInit;
}

export function storeDeployParameters(src: DeployParameters) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.mode, 257);
        if (src.body !== null && src.body !== undefined) { b_0.storeBit(true).storeRef(src.body); } else { b_0.storeBit(false); }
        b_0.storeInt(src.value, 257);
        b_0.storeBit(src.bounce);
        b_0.store(storeStateInit(src.init));
    };
}

export function loadDeployParameters(slice: Slice) {
    const sc_0 = slice;
    const _mode = sc_0.loadIntBig(257);
    const _body = sc_0.loadBit() ? sc_0.loadRef() : null;
    const _value = sc_0.loadIntBig(257);
    const _bounce = sc_0.loadBit();
    const _init = loadStateInit(sc_0);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function loadGetterTupleDeployParameters(source: TupleReader) {
    const _mode = source.readBigNumber();
    const _body = source.readCellOpt();
    const _value = source.readBigNumber();
    const _bounce = source.readBoolean();
    const _init = loadGetterTupleStateInit(source);
    return { $$type: 'DeployParameters' as const, mode: _mode, body: _body, value: _value, bounce: _bounce, init: _init };
}

export function storeTupleDeployParameters(source: DeployParameters) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.mode);
    builder.writeCell(source.body);
    builder.writeNumber(source.value);
    builder.writeBoolean(source.bounce);
    builder.writeTuple(storeTupleStateInit(source.init));
    return builder.build();
}

export function dictValueParserDeployParameters(): DictionaryValue<DeployParameters> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDeployParameters(src)).endCell());
        },
        parse: (src) => {
            return loadDeployParameters(src.loadRef().beginParse());
        }
    }
}

export type StdAddress = {
    $$type: 'StdAddress';
    workchain: bigint;
    address: bigint;
}

export function storeStdAddress(src: StdAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 8);
        b_0.storeUint(src.address, 256);
    };
}

export function loadStdAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(8);
    const _address = sc_0.loadUintBig(256);
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleStdAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readBigNumber();
    return { $$type: 'StdAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleStdAddress(source: StdAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeNumber(source.address);
    return builder.build();
}

export function dictValueParserStdAddress(): DictionaryValue<StdAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeStdAddress(src)).endCell());
        },
        parse: (src) => {
            return loadStdAddress(src.loadRef().beginParse());
        }
    }
}

export type VarAddress = {
    $$type: 'VarAddress';
    workchain: bigint;
    address: Slice;
}

export function storeVarAddress(src: VarAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeInt(src.workchain, 32);
        b_0.storeRef(src.address.asCell());
    };
}

export function loadVarAddress(slice: Slice) {
    const sc_0 = slice;
    const _workchain = sc_0.loadIntBig(32);
    const _address = sc_0.loadRef().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function loadGetterTupleVarAddress(source: TupleReader) {
    const _workchain = source.readBigNumber();
    const _address = source.readCell().asSlice();
    return { $$type: 'VarAddress' as const, workchain: _workchain, address: _address };
}

export function storeTupleVarAddress(source: VarAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.workchain);
    builder.writeSlice(source.address.asCell());
    return builder.build();
}

export function dictValueParserVarAddress(): DictionaryValue<VarAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeVarAddress(src)).endCell());
        },
        parse: (src) => {
            return loadVarAddress(src.loadRef().beginParse());
        }
    }
}

export type BasechainAddress = {
    $$type: 'BasechainAddress';
    hash: bigint | null;
}

export function storeBasechainAddress(src: BasechainAddress) {
    return (builder: Builder) => {
        const b_0 = builder;
        if (src.hash !== null && src.hash !== undefined) { b_0.storeBit(true).storeInt(src.hash, 257); } else { b_0.storeBit(false); }
    };
}

export function loadBasechainAddress(slice: Slice) {
    const sc_0 = slice;
    const _hash = sc_0.loadBit() ? sc_0.loadIntBig(257) : null;
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function loadGetterTupleBasechainAddress(source: TupleReader) {
    const _hash = source.readBigNumberOpt();
    return { $$type: 'BasechainAddress' as const, hash: _hash };
}

export function storeTupleBasechainAddress(source: BasechainAddress) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.hash);
    return builder.build();
}

export function dictValueParserBasechainAddress(): DictionaryValue<BasechainAddress> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeBasechainAddress(src)).endCell());
        },
        parse: (src) => {
            return loadBasechainAddress(src.loadRef().beginParse());
        }
    }
}

export type ConfirmDelivery = {
    $$type: 'ConfirmDelivery';
}

export function storeConfirmDelivery(src: ConfirmDelivery) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1, 32);
    };
}

export function loadConfirmDelivery(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1) { throw Error('Invalid prefix'); }
    return { $$type: 'ConfirmDelivery' as const };
}

export function loadTupleConfirmDelivery(source: TupleReader) {
    return { $$type: 'ConfirmDelivery' as const };
}

export function loadGetterTupleConfirmDelivery(source: TupleReader) {
    return { $$type: 'ConfirmDelivery' as const };
}

export function storeTupleConfirmDelivery(source: ConfirmDelivery) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserConfirmDelivery(): DictionaryValue<ConfirmDelivery> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeConfirmDelivery(src)).endCell());
        },
        parse: (src) => {
            return loadConfirmDelivery(src.loadRef().beginParse());
        }
    }
}

export type RaiseDispute = {
    $$type: 'RaiseDispute';
}

export function storeRaiseDispute(src: RaiseDispute) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(2, 32);
    };
}

export function loadRaiseDispute(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 2) { throw Error('Invalid prefix'); }
    return { $$type: 'RaiseDispute' as const };
}

export function loadTupleRaiseDispute(source: TupleReader) {
    return { $$type: 'RaiseDispute' as const };
}

export function loadGetterTupleRaiseDispute(source: TupleReader) {
    return { $$type: 'RaiseDispute' as const };
}

export function storeTupleRaiseDispute(source: RaiseDispute) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserRaiseDispute(): DictionaryValue<RaiseDispute> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRaiseDispute(src)).endCell());
        },
        parse: (src) => {
            return loadRaiseDispute(src.loadRef().beginParse());
        }
    }
}

export type ResolveToBuyer = {
    $$type: 'ResolveToBuyer';
}

export function storeResolveToBuyer(src: ResolveToBuyer) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(3, 32);
    };
}

export function loadResolveToBuyer(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 3) { throw Error('Invalid prefix'); }
    return { $$type: 'ResolveToBuyer' as const };
}

export function loadTupleResolveToBuyer(source: TupleReader) {
    return { $$type: 'ResolveToBuyer' as const };
}

export function loadGetterTupleResolveToBuyer(source: TupleReader) {
    return { $$type: 'ResolveToBuyer' as const };
}

export function storeTupleResolveToBuyer(source: ResolveToBuyer) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserResolveToBuyer(): DictionaryValue<ResolveToBuyer> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeResolveToBuyer(src)).endCell());
        },
        parse: (src) => {
            return loadResolveToBuyer(src.loadRef().beginParse());
        }
    }
}

export type ResolveToSeller = {
    $$type: 'ResolveToSeller';
}

export function storeResolveToSeller(src: ResolveToSeller) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(4, 32);
    };
}

export function loadResolveToSeller(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 4) { throw Error('Invalid prefix'); }
    return { $$type: 'ResolveToSeller' as const };
}

export function loadTupleResolveToSeller(source: TupleReader) {
    return { $$type: 'ResolveToSeller' as const };
}

export function loadGetterTupleResolveToSeller(source: TupleReader) {
    return { $$type: 'ResolveToSeller' as const };
}

export function storeTupleResolveToSeller(source: ResolveToSeller) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserResolveToSeller(): DictionaryValue<ResolveToSeller> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeResolveToSeller(src)).endCell());
        },
        parse: (src) => {
            return loadResolveToSeller(src.loadRef().beginParse());
        }
    }
}

export type CancelIfNoDeposit = {
    $$type: 'CancelIfNoDeposit';
}

export function storeCancelIfNoDeposit(src: CancelIfNoDeposit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(5, 32);
    };
}

export function loadCancelIfNoDeposit(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 5) { throw Error('Invalid prefix'); }
    return { $$type: 'CancelIfNoDeposit' as const };
}

export function loadTupleCancelIfNoDeposit(source: TupleReader) {
    return { $$type: 'CancelIfNoDeposit' as const };
}

export function loadGetterTupleCancelIfNoDeposit(source: TupleReader) {
    return { $$type: 'CancelIfNoDeposit' as const };
}

export function storeTupleCancelIfNoDeposit(source: CancelIfNoDeposit) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserCancelIfNoDeposit(): DictionaryValue<CancelIfNoDeposit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeCancelIfNoDeposit(src)).endCell());
        },
        parse: (src) => {
            return loadCancelIfNoDeposit(src.loadRef().beginParse());
        }
    }
}

export type ClaimExpired = {
    $$type: 'ClaimExpired';
}

export function storeClaimExpired(src: ClaimExpired) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(6, 32);
    };
}

export function loadClaimExpired(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 6) { throw Error('Invalid prefix'); }
    return { $$type: 'ClaimExpired' as const };
}

export function loadTupleClaimExpired(source: TupleReader) {
    return { $$type: 'ClaimExpired' as const };
}

export function loadGetterTupleClaimExpired(source: TupleReader) {
    return { $$type: 'ClaimExpired' as const };
}

export function storeTupleClaimExpired(source: ClaimExpired) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserClaimExpired(): DictionaryValue<ClaimExpired> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeClaimExpired(src)).endCell());
        },
        parse: (src) => {
            return loadClaimExpired(src.loadRef().beginParse());
        }
    }
}

export type EmergencyWithdraw = {
    $$type: 'EmergencyWithdraw';
}

export function storeEmergencyWithdraw(src: EmergencyWithdraw) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(7, 32);
    };
}

export function loadEmergencyWithdraw(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 7) { throw Error('Invalid prefix'); }
    return { $$type: 'EmergencyWithdraw' as const };
}

export function loadTupleEmergencyWithdraw(source: TupleReader) {
    return { $$type: 'EmergencyWithdraw' as const };
}

export function loadGetterTupleEmergencyWithdraw(source: TupleReader) {
    return { $$type: 'EmergencyWithdraw' as const };
}

export function storeTupleEmergencyWithdraw(source: EmergencyWithdraw) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserEmergencyWithdraw(): DictionaryValue<EmergencyWithdraw> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEmergencyWithdraw(src)).endCell());
        },
        parse: (src) => {
            return loadEmergencyWithdraw(src.loadRef().beginParse());
        }
    }
}

export type ConfirmDeposit = {
    $$type: 'ConfirmDeposit';
}

export function storeConfirmDeposit(src: ConfirmDeposit) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(8, 32);
    };
}

export function loadConfirmDeposit(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 8) { throw Error('Invalid prefix'); }
    return { $$type: 'ConfirmDeposit' as const };
}

export function loadTupleConfirmDeposit(source: TupleReader) {
    return { $$type: 'ConfirmDeposit' as const };
}

export function loadGetterTupleConfirmDeposit(source: TupleReader) {
    return { $$type: 'ConfirmDeposit' as const };
}

export function storeTupleConfirmDeposit(source: ConfirmDeposit) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserConfirmDeposit(): DictionaryValue<ConfirmDeposit> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeConfirmDeposit(src)).endCell());
        },
        parse: (src) => {
            return loadConfirmDeposit(src.loadRef().beginParse());
        }
    }
}

export type RetryPayout = {
    $$type: 'RetryPayout';
}

export function storeRetryPayout(src: RetryPayout) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(9, 32);
    };
}

export function loadRetryPayout(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 9) { throw Error('Invalid prefix'); }
    return { $$type: 'RetryPayout' as const };
}

export function loadTupleRetryPayout(source: TupleReader) {
    return { $$type: 'RetryPayout' as const };
}

export function loadGetterTupleRetryPayout(source: TupleReader) {
    return { $$type: 'RetryPayout' as const };
}

export function storeTupleRetryPayout(source: RetryPayout) {
    const builder = new TupleBuilder();
    return builder.build();
}

export function dictValueParserRetryPayout(): DictionaryValue<RetryPayout> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeRetryPayout(src)).endCell());
        },
        parse: (src) => {
            return loadRetryPayout(src.loadRef().beginParse());
        }
    }
}

export type TokenNotification = {
    $$type: 'TokenNotification';
    queryId: bigint;
    amount: bigint;
    from: Address;
    forwardPayload: Slice;
}

export function storeTokenNotification(src: TokenNotification) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(1935855772, 32);
        b_0.storeUint(src.queryId, 64);
        b_0.storeUint(src.amount, 128);
        b_0.storeAddress(src.from);
        b_0.storeBuilder(src.forwardPayload.asBuilder());
    };
}

export function loadTokenNotification(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 1935855772) { throw Error('Invalid prefix'); }
    const _queryId = sc_0.loadUintBig(64);
    const _amount = sc_0.loadUintBig(128);
    const _from = sc_0.loadAddress();
    const _forwardPayload = sc_0;
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function loadGetterTupleTokenNotification(source: TupleReader) {
    const _queryId = source.readBigNumber();
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _forwardPayload = source.readCell().asSlice();
    return { $$type: 'TokenNotification' as const, queryId: _queryId, amount: _amount, from: _from, forwardPayload: _forwardPayload };
}

export function storeTupleTokenNotification(source: TokenNotification) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.queryId);
    builder.writeNumber(source.amount);
    builder.writeAddress(source.from);
    builder.writeSlice(source.forwardPayload.asCell());
    return builder.build();
}

export function dictValueParserTokenNotification(): DictionaryValue<TokenNotification> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTokenNotification(src)).endCell());
        },
        parse: (src) => {
            return loadTokenNotification(src.loadRef().beginParse());
        }
    }
}

export type DepositReceived = {
    $$type: 'DepositReceived';
    amount: bigint;
    from: Address;
    jettonWallet: Address;
}

export function storeDepositReceived(src: DepositReceived) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(16, 32);
        b_0.storeUint(src.amount, 128);
        b_0.storeAddress(src.from);
        b_0.storeAddress(src.jettonWallet);
    };
}

export function loadDepositReceived(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 16) { throw Error('Invalid prefix'); }
    const _amount = sc_0.loadUintBig(128);
    const _from = sc_0.loadAddress();
    const _jettonWallet = sc_0.loadAddress();
    return { $$type: 'DepositReceived' as const, amount: _amount, from: _from, jettonWallet: _jettonWallet };
}

export function loadTupleDepositReceived(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _jettonWallet = source.readAddress();
    return { $$type: 'DepositReceived' as const, amount: _amount, from: _from, jettonWallet: _jettonWallet };
}

export function loadGetterTupleDepositReceived(source: TupleReader) {
    const _amount = source.readBigNumber();
    const _from = source.readAddress();
    const _jettonWallet = source.readAddress();
    return { $$type: 'DepositReceived' as const, amount: _amount, from: _from, jettonWallet: _jettonWallet };
}

export function storeTupleDepositReceived(source: DepositReceived) {
    const builder = new TupleBuilder();
    builder.writeNumber(source.amount);
    builder.writeAddress(source.from);
    builder.writeAddress(source.jettonWallet);
    return builder.build();
}

export function dictValueParserDepositReceived(): DictionaryValue<DepositReceived> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDepositReceived(src)).endCell());
        },
        parse: (src) => {
            return loadDepositReceived(src.loadRef().beginParse());
        }
    }
}

export type DepositConfirmed = {
    $$type: 'DepositConfirmed';
    confirmedBy: Address;
}

export function storeDepositConfirmed(src: DepositConfirmed) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(17, 32);
        b_0.storeAddress(src.confirmedBy);
    };
}

export function loadDepositConfirmed(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 17) { throw Error('Invalid prefix'); }
    const _confirmedBy = sc_0.loadAddress();
    return { $$type: 'DepositConfirmed' as const, confirmedBy: _confirmedBy };
}

export function loadTupleDepositConfirmed(source: TupleReader) {
    const _confirmedBy = source.readAddress();
    return { $$type: 'DepositConfirmed' as const, confirmedBy: _confirmedBy };
}

export function loadGetterTupleDepositConfirmed(source: TupleReader) {
    const _confirmedBy = source.readAddress();
    return { $$type: 'DepositConfirmed' as const, confirmedBy: _confirmedBy };
}

export function storeTupleDepositConfirmed(source: DepositConfirmed) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.confirmedBy);
    return builder.build();
}

export function dictValueParserDepositConfirmed(): DictionaryValue<DepositConfirmed> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeDepositConfirmed(src)).endCell());
        },
        parse: (src) => {
            return loadDepositConfirmed(src.loadRef().beginParse());
        }
    }
}

export type TradeCompleted = {
    $$type: 'TradeCompleted';
    buyer: Address;
    amount: bigint;
    fee: bigint;
}

export function storeTradeCompleted(src: TradeCompleted) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(18, 32);
        b_0.storeAddress(src.buyer);
        b_0.storeUint(src.amount, 128);
        b_0.storeUint(src.fee, 128);
    };
}

export function loadTradeCompleted(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 18) { throw Error('Invalid prefix'); }
    const _buyer = sc_0.loadAddress();
    const _amount = sc_0.loadUintBig(128);
    const _fee = sc_0.loadUintBig(128);
    return { $$type: 'TradeCompleted' as const, buyer: _buyer, amount: _amount, fee: _fee };
}

export function loadTupleTradeCompleted(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _fee = source.readBigNumber();
    return { $$type: 'TradeCompleted' as const, buyer: _buyer, amount: _amount, fee: _fee };
}

export function loadGetterTupleTradeCompleted(source: TupleReader) {
    const _buyer = source.readAddress();
    const _amount = source.readBigNumber();
    const _fee = source.readBigNumber();
    return { $$type: 'TradeCompleted' as const, buyer: _buyer, amount: _amount, fee: _fee };
}

export function storeTupleTradeCompleted(source: TradeCompleted) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.buyer);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.fee);
    return builder.build();
}

export function dictValueParserTradeCompleted(): DictionaryValue<TradeCompleted> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeTradeCompleted(src)).endCell());
        },
        parse: (src) => {
            return loadTradeCompleted(src.loadRef().beginParse());
        }
    }
}

export type PayoutRetried = {
    $$type: 'PayoutRetried';
    retriedBy: Address;
    queryId: bigint;
}

export function storePayoutRetried(src: PayoutRetried) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeUint(19, 32);
        b_0.storeAddress(src.retriedBy);
        b_0.storeUint(src.queryId, 64);
    };
}

export function loadPayoutRetried(slice: Slice) {
    const sc_0 = slice;
    if (sc_0.loadUint(32) !== 19) { throw Error('Invalid prefix'); }
    const _retriedBy = sc_0.loadAddress();
    const _queryId = sc_0.loadUintBig(64);
    return { $$type: 'PayoutRetried' as const, retriedBy: _retriedBy, queryId: _queryId };
}

export function loadTuplePayoutRetried(source: TupleReader) {
    const _retriedBy = source.readAddress();
    const _queryId = source.readBigNumber();
    return { $$type: 'PayoutRetried' as const, retriedBy: _retriedBy, queryId: _queryId };
}

export function loadGetterTuplePayoutRetried(source: TupleReader) {
    const _retriedBy = source.readAddress();
    const _queryId = source.readBigNumber();
    return { $$type: 'PayoutRetried' as const, retriedBy: _retriedBy, queryId: _queryId };
}

export function storeTuplePayoutRetried(source: PayoutRetried) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.retriedBy);
    builder.writeNumber(source.queryId);
    return builder.build();
}

export function dictValueParserPayoutRetried(): DictionaryValue<PayoutRetried> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storePayoutRetried(src)).endCell());
        },
        parse: (src) => {
            return loadPayoutRetried(src.loadRef().beginParse());
        }
    }
}

export type Escrow$Data = {
    $$type: 'Escrow$Data';
    seller: Address;
    buyer: Address;
    admin: Address;
    expectedJettonWallet: Address | null;
    amount: bigint;
    commissionBps: bigint;
    feeW1: Address;
    feeW2: Address;
    feeW3: Address;
    status: bigint;
    deposited: bigint;
    deadline: bigint;
    jettonWallet: Address | null;
    depositVerified: boolean;
    payoutAttempted: boolean;
}

export function storeEscrow$Data(src: Escrow$Data) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.seller);
        b_0.storeAddress(src.buyer);
        b_0.storeAddress(src.admin);
        const b_1 = new Builder();
        b_1.storeAddress(src.expectedJettonWallet);
        b_1.storeInt(src.amount, 257);
        b_1.storeInt(src.commissionBps, 257);
        const b_2 = new Builder();
        b_2.storeAddress(src.feeW1);
        b_2.storeAddress(src.feeW2);
        b_2.storeAddress(src.feeW3);
        const b_3 = new Builder();
        b_3.storeInt(src.status, 257);
        b_3.storeUint(src.deposited, 128);
        b_3.storeUint(src.deadline, 32);
        b_3.storeAddress(src.jettonWallet);
        b_3.storeBit(src.depositVerified);
        b_3.storeBit(src.payoutAttempted);
        b_2.storeRef(b_3.endCell());
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

export function loadEscrow$Data(slice: Slice) {
    const sc_0 = slice;
    const _seller = sc_0.loadAddress();
    const _buyer = sc_0.loadAddress();
    const _admin = sc_0.loadAddress();
    const sc_1 = sc_0.loadRef().beginParse();
    const _expectedJettonWallet = sc_1.loadMaybeAddress();
    const _amount = sc_1.loadIntBig(257);
    const _commissionBps = sc_1.loadIntBig(257);
    const sc_2 = sc_1.loadRef().beginParse();
    const _feeW1 = sc_2.loadAddress();
    const _feeW2 = sc_2.loadAddress();
    const _feeW3 = sc_2.loadAddress();
    const sc_3 = sc_2.loadRef().beginParse();
    const _status = sc_3.loadIntBig(257);
    const _deposited = sc_3.loadUintBig(128);
    const _deadline = sc_3.loadUintBig(32);
    const _jettonWallet = sc_3.loadMaybeAddress();
    const _depositVerified = sc_3.loadBit();
    const _payoutAttempted = sc_3.loadBit();
    return { $$type: 'Escrow$Data' as const, seller: _seller, buyer: _buyer, admin: _admin, expectedJettonWallet: _expectedJettonWallet, amount: _amount, commissionBps: _commissionBps, feeW1: _feeW1, feeW2: _feeW2, feeW3: _feeW3, status: _status, deposited: _deposited, deadline: _deadline, jettonWallet: _jettonWallet, depositVerified: _depositVerified, payoutAttempted: _payoutAttempted };
}

export function loadTupleEscrow$Data(source: TupleReader) {
    const _seller = source.readAddress();
    const _buyer = source.readAddress();
    const _admin = source.readAddress();
    const _expectedJettonWallet = source.readAddressOpt();
    const _amount = source.readBigNumber();
    const _commissionBps = source.readBigNumber();
    const _feeW1 = source.readAddress();
    const _feeW2 = source.readAddress();
    const _feeW3 = source.readAddress();
    const _status = source.readBigNumber();
    const _deposited = source.readBigNumber();
    const _deadline = source.readBigNumber();
    const _jettonWallet = source.readAddressOpt();
    const _depositVerified = source.readBoolean();
    const _payoutAttempted = source.readBoolean();
    return { $$type: 'Escrow$Data' as const, seller: _seller, buyer: _buyer, admin: _admin, expectedJettonWallet: _expectedJettonWallet, amount: _amount, commissionBps: _commissionBps, feeW1: _feeW1, feeW2: _feeW2, feeW3: _feeW3, status: _status, deposited: _deposited, deadline: _deadline, jettonWallet: _jettonWallet, depositVerified: _depositVerified, payoutAttempted: _payoutAttempted };
}

export function loadGetterTupleEscrow$Data(source: TupleReader) {
    const _seller = source.readAddress();
    const _buyer = source.readAddress();
    const _admin = source.readAddress();
    const _expectedJettonWallet = source.readAddressOpt();
    const _amount = source.readBigNumber();
    const _commissionBps = source.readBigNumber();
    const _feeW1 = source.readAddress();
    const _feeW2 = source.readAddress();
    const _feeW3 = source.readAddress();
    const _status = source.readBigNumber();
    const _deposited = source.readBigNumber();
    const _deadline = source.readBigNumber();
    const _jettonWallet = source.readAddressOpt();
    const _depositVerified = source.readBoolean();
    const _payoutAttempted = source.readBoolean();
    return { $$type: 'Escrow$Data' as const, seller: _seller, buyer: _buyer, admin: _admin, expectedJettonWallet: _expectedJettonWallet, amount: _amount, commissionBps: _commissionBps, feeW1: _feeW1, feeW2: _feeW2, feeW3: _feeW3, status: _status, deposited: _deposited, deadline: _deadline, jettonWallet: _jettonWallet, depositVerified: _depositVerified, payoutAttempted: _payoutAttempted };
}

export function storeTupleEscrow$Data(source: Escrow$Data) {
    const builder = new TupleBuilder();
    builder.writeAddress(source.seller);
    builder.writeAddress(source.buyer);
    builder.writeAddress(source.admin);
    builder.writeAddress(source.expectedJettonWallet);
    builder.writeNumber(source.amount);
    builder.writeNumber(source.commissionBps);
    builder.writeAddress(source.feeW1);
    builder.writeAddress(source.feeW2);
    builder.writeAddress(source.feeW3);
    builder.writeNumber(source.status);
    builder.writeNumber(source.deposited);
    builder.writeNumber(source.deadline);
    builder.writeAddress(source.jettonWallet);
    builder.writeBoolean(source.depositVerified);
    builder.writeBoolean(source.payoutAttempted);
    return builder.build();
}

export function dictValueParserEscrow$Data(): DictionaryValue<Escrow$Data> {
    return {
        serialize: (src, builder) => {
            builder.storeRef(beginCell().store(storeEscrow$Data(src)).endCell());
        },
        parse: (src) => {
            return loadEscrow$Data(src.loadRef().beginParse());
        }
    }
}

 type Escrow_init_args = {
    $$type: 'Escrow_init_args';
    seller_: Address;
    buyer_: Address;
    admin_: Address;
    amount_: bigint;
    commissionBps_: bigint;
    feeW1_: Address;
    feeW2_: Address;
    feeW3_: Address;
    deadline_: bigint;
    expectedJettonWallet_: Address | null;
}

function initEscrow_init_args(src: Escrow_init_args) {
    return (builder: Builder) => {
        const b_0 = builder;
        b_0.storeAddress(src.seller_);
        b_0.storeAddress(src.buyer_);
        b_0.storeAddress(src.admin_);
        b_0.storeUint(src.amount_, 128);
        b_0.storeUint(src.commissionBps_, 16);
        const b_1 = new Builder();
        b_1.storeAddress(src.feeW1_);
        b_1.storeAddress(src.feeW2_);
        b_1.storeAddress(src.feeW3_);
        const b_2 = new Builder();
        b_2.storeInt(src.deadline_, 257);
        b_2.storeAddress(src.expectedJettonWallet_);
        b_1.storeRef(b_2.endCell());
        b_0.storeRef(b_1.endCell());
    };
}

async function Escrow_init(seller_: Address, buyer_: Address, admin_: Address, amount_: bigint, commissionBps_: bigint, feeW1_: Address, feeW2_: Address, feeW3_: Address, deadline_: bigint, expectedJettonWallet_: Address | null) {
    const __code = Cell.fromHex('b5ee9c7241022101000b7f000110ff0020e303f2c80b0103f83001d072d721d200d200fa4021103450666f04f86102f862ed44d0d200018e55fa40fa40fa40d37fd30fd401d0fa40fa40fa40d430d0810101d700d72c01916d93fa4001e231105a10591058105710560ad1550881186327c200f2f425812710bbf2e67d70541700102710261025102455026d7070e30d1110e3020e0203040096fa40fa40fa40d401d0d72c01916d93fa4001e201810101d700810101d700d430d0fa40fa40fa40d430d0810101d700d37fd31fd72c01916d93fa4001e201d200d2003010cf10ce10cd6c1f00065f0f3004a4d70d1ff2e0822182107362d09cbae3023020c001e30220c0028eb330812277f8422dc705f2f48200a0d704c00114f2f48200f4982df2f410bd10ac109b108a107910681057104610357244554313e020c0030507200b01fe31d33f31d37ffa403082008b9b26c000f2f482008fe8531fc705f2f4812936532bbaf2f4811a89f8420f11100f0e11100e0d11100d0c11100c0b11100b0a11100a0911100908111008071110070611100605111005041110040311100302111102011112012c6eb39a2c206e925b7092c705e295f828c705b3e235355b50ee060198f2f4f8422b7071f842102f01111001c8552080105004cb1f12cb7fcecec9c88258c000000000000000000000000101cb67ccc970fb0010be10ad109c108b107a106910581047103604054133200492308200d8ecf8422ec705f2f48200a0d704c00114f2f48200f4982df2f48121032eb3f2f410bd10ac109b108a1079106810571046103573515241550403db3c3120db3c21db3c54721018191a0803fedb3c5373a17f708bf547261646520636f6d706c657465648111011151110561411100f11140f0e11130e0d11120d0c11160c0b0a11140a0911130908111208071116070605111405041113040211150256130201111601db3c718be506c6174666f726d20666565203181110111111100f11100f10ef2a10ef10de0c0d10ab1c1f0903fc109a108910781067105610451034111659db3c728be506c6174666f726d20666565203281110111111100f11100f10ef2910ef10de10cd0b0c109a108910781067105610451034111459db3c738be506c6174666f726d20666565203381110111111100f11100f10ef10de2810de10cd10bc0a0b108910781067105610451f1f0a026e103459db3c2d02011110011111c8552080125004cb1f12cecb7fcb7fc9c88258c000000000000000000000000101cb67ccc970fb00551c1f2004e4e30220c0048f67308200e18ff8422cc705f2f48132b224c00192347f9304c002e214f2f48200f4982df2f47480148d06511a5cdc1d5d19481c995cdbdb1d9959080b481cd95b1b195ca02e11110e11100e10df10ce10bd10ac2510ac109b108a104908105710565033044515db3ce020c0050c1f20100490308200e18ff8422cc705f2f48132b224c00192347f9304c002e214f2f48200f4982df2f410bd10ac109b108a1079106810571046103573515241550403db3c20db3c21db3c54721018191a0d03fedb3c5284a17a8d06111a5cdc1d5d19481c995cdbdb1d9959080b48189d5e595ca0111111141111561311111110111311100f11150f0e0d11130d0c11150c0b0a11130a09111509080711130706111506050411130411145520db3c800b8be506c6174666f726d20666565203181110111111100f11100f10ef2a10ef10de0c1c1f0e03fe0d10ab109a108910781067105610451034111359db3c800c8be506c6174666f726d20666565203281110111111100f11100f10ef2910ef10de10cd0b0c109a10891078106710561045103459db3c800d8be506c6174666f726d20666565203381110111111100f11100f10ef10de2810de10cd10bc0a0b10891078106710561f1f0f01ba1045103459db3cc87f01ca0055e050efce1cce1acec85009206e9430cf84809201cee217810101cf0015810101cf0003c8ce12cece02c8810101cf0013cb7f14cb1f5004206e9430cf84809201cee214ca0014ca0013cd12cdcdc9ed541f04b88ecc308137d6f8422ec705917f95f8422cc705e2f2f4812aac04c00014f2f4f8422cc7059320c3009170e29a8200a20df82322bef2f4de10bd10ac109b108a107910681057104610357444554313e020c006e30220c008e30220c0092011151604a8308200f7aaf8422dc705f2f48200a0d704c00114f2f48200c4d621c300f2f48200bc49f82322bef2f48200f4982df2f410bd10ac109b108a1079106810571046103573515241550403db3c20db3c21db3c54721018191a1203fedb3c5284a1801e8d07151c98591948195e1c1a5c9959080b48185d5d1bc81c995b19585cd960111111141111561311111110111311100f11150f0e0d11130d0c11150c0b0a11130a09111509080711130706111506050411130411145520db3c801f8be506c6174666f726d20666565203181110111111100f11100f10ef2a1c1f1303fc10ef10de0c0d10ab109a108910781067105610451034111359db3c80208be506c6174666f726d20666565203281110111111100f11100f10ef2910ef10de10cd0b0c109a10891078106710561045103459db3c80218be506c6174666f726d20666565203381110111111100f11100f10ef10de2810de10cd10bc0a0b10891f1f1401c61078106710561045103459db3cc87f01ca0055e050efce1cce1acec85009206e9430cf84809201cee217810101cf0015810101cf0003c8ce12cece02c8810101cf0013cb7f14cb1f5004206e9430cf84809201cee214ca0014ca0013cd12cdcdc9ed541f01c2308200f9f0f8422cc705f2f48200d95c24c001f2f481410b216eb3f2f48200bd0c0eb31ef2f47ff842c801801158cb1fcec9c88258c000000000000000000000000101cb67ccc970fb0010ce10bd10ac109b108a107910681057104610354403022003d6e302c0078f5f81404df8422cc705f2f48132b224c00192347f9304c002e214f2f48200eccf2df2f47480638d05115b595c99d95b98de481dda5d1a191c985dd85b200e11100e10df2c0f10ce10bd10ac2510ac109b108a104908105710565033044515db3ce05f0ff2c082171f20047c30813b6af8422cc705f2f48200879b24c003f2f48200f4982ef2f410ce10bd10ac109b108a1079221079106810571046445503db3c20db3c21db3c54721018191a1b000e2aa8812710a9040012811b58a8812710a90400128108caa8812710a90403f8db3c5284a180648d05d51c9859194818dbdb5c1b195d1959080b481c995d1c9e60111111141111561311111110111311100f11150f0e0d11130d0c11150c0b0a11130a09111509080711130706111506050411130411145520db3c80658d05941b185d199bdc9b48199959480c480b481c995d1c9e601110111111101c1f1d000859a101a103fc0f11100f10ef2a10ef10de0c0d10ab109a108910781067105610451034111359db3c80668d05941b185d199bdc9b48199959480c880b481c995d1c9e601110111111100f11100f10ef2910ef10de10cd0b0c109a10891078106710561045103459db3c80678d05941b185d199bdc9b48199959480cc80b481c995d1c9e601f1f1e01f81110111111100f11100f10ef10de2810de10cd10bc0a0b10891078106710561045103459db3cc87f01ca0055e050efce1cce1acec85009206e9430cf84809201cee217810101cf0015810101cf0003c8ce12cece02c8810101cf0013cb7f14cb1f5004206e9430cf84809201cee214ca0014ca0013cd12cdcdc9ed541f00ec3081410b266eb3f2f47070c882100f8a7ea501cb1f13cb3f5003fa025003cf16f828cf1612ca00820afaf080fa02ca00c923206ef2d080821008f0d1805871015a6d6d40037fc8cf8580ca00cf8440ce01fa028069cf40025c6e016eb0935bcf819d58cf8680cf8480f400f400cf81e2f400c901fb0000acc87f01ca0055e050efce1cce1acec85009206e9430cf84809201cee217810101cf0015810101cf0003c8ce12cece02c8810101cf0013cb7f14cb1f5004206e9430cf84809201cee214ca0014ca0013cd12cdcdc9ed54018732b6');
    const builder = beginCell();
    builder.storeUint(0, 1);
    initEscrow_init_args({ $$type: 'Escrow_init_args', seller_, buyer_, admin_, amount_, commissionBps_, feeW1_, feeW2_, feeW3_, deadline_, expectedJettonWallet_ })(builder);
    const __data = builder.endCell();
    return { code: __code, data: __data };
}

export const Escrow_errors = {
    2: { message: "Stack underflow" },
    3: { message: "Stack overflow" },
    4: { message: "Integer overflow" },
    5: { message: "Integer out of expected range" },
    6: { message: "Invalid opcode" },
    7: { message: "Type check error" },
    8: { message: "Cell overflow" },
    9: { message: "Cell underflow" },
    10: { message: "Dictionary error" },
    11: { message: "'Unknown' error" },
    12: { message: "Fatal error" },
    13: { message: "Out of gas error" },
    14: { message: "Virtualization error" },
    32: { message: "Action list is invalid" },
    33: { message: "Action list is too long" },
    34: { message: "Action is invalid or not supported" },
    35: { message: "Invalid source address in outbound message" },
    36: { message: "Invalid destination address in outbound message" },
    37: { message: "Not enough Toncoin" },
    38: { message: "Not enough extra currencies" },
    39: { message: "Outbound message does not fit into a cell after rewriting" },
    40: { message: "Cannot process a message" },
    41: { message: "Library reference is null" },
    42: { message: "Library change action error" },
    43: { message: "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree" },
    50: { message: "Account state size exceeded limits" },
    128: { message: "Null reference exception" },
    129: { message: "Invalid serialization prefix" },
    130: { message: "Invalid incoming message" },
    131: { message: "Constraints error" },
    132: { message: "Access denied" },
    133: { message: "Contract stopped" },
    134: { message: "Invalid argument" },
    135: { message: "Code of a contract was not found" },
    136: { message: "Invalid standard address" },
    138: { message: "Not a basechain address" },
    1661: { message: "Commission must be <= 100%" },
    6243: { message: "Amount must be > 0" },
    6793: { message: "Invalid USDT jetton wallet" },
    8451: { message: "Payout already attempted" },
    8823: { message: "Only buyer can dispute" },
    10550: { message: "Deposit must equal trade amount" },
    10924: { message: "Not pending deposit" },
    12978: { message: "Invalid status - already resolved" },
    14294: { message: "Not allowed" },
    15210: { message: "Only admin can retry payouts" },
    16461: { message: "Only admin" },
    16651: { message: "Jetton wallet not set" },
    34715: { message: "Payouts not in progress" },
    35739: { message: "Already deposited" },
    36840: { message: "Only seller can deposit" },
    41175: { message: "Must be active - already resolved" },
    41485: { message: "Seller must wait until deadline" },
    48201: { message: "Deadline not reached" },
    48396: { message: "Deposit already confirmed" },
    50390: { message: "No deadline set" },
    55532: { message: "Only seller can confirm" },
    55644: { message: "No deposit to confirm" },
    57743: { message: "Only admin can resolve" },
    60623: { message: "No verified deposit" },
    62616: { message: "Deposit not verified" },
    63402: { message: "Only buyer can claim expired" },
    63984: { message: "Only admin can confirm deposits" },
} as const

export const Escrow_errors_backward = {
    "Stack underflow": 2,
    "Stack overflow": 3,
    "Integer overflow": 4,
    "Integer out of expected range": 5,
    "Invalid opcode": 6,
    "Type check error": 7,
    "Cell overflow": 8,
    "Cell underflow": 9,
    "Dictionary error": 10,
    "'Unknown' error": 11,
    "Fatal error": 12,
    "Out of gas error": 13,
    "Virtualization error": 14,
    "Action list is invalid": 32,
    "Action list is too long": 33,
    "Action is invalid or not supported": 34,
    "Invalid source address in outbound message": 35,
    "Invalid destination address in outbound message": 36,
    "Not enough Toncoin": 37,
    "Not enough extra currencies": 38,
    "Outbound message does not fit into a cell after rewriting": 39,
    "Cannot process a message": 40,
    "Library reference is null": 41,
    "Library change action error": 42,
    "Exceeded maximum number of cells in the library or the maximum depth of the Merkle tree": 43,
    "Account state size exceeded limits": 50,
    "Null reference exception": 128,
    "Invalid serialization prefix": 129,
    "Invalid incoming message": 130,
    "Constraints error": 131,
    "Access denied": 132,
    "Contract stopped": 133,
    "Invalid argument": 134,
    "Code of a contract was not found": 135,
    "Invalid standard address": 136,
    "Not a basechain address": 138,
    "Commission must be <= 100%": 1661,
    "Amount must be > 0": 6243,
    "Invalid USDT jetton wallet": 6793,
    "Payout already attempted": 8451,
    "Only buyer can dispute": 8823,
    "Deposit must equal trade amount": 10550,
    "Not pending deposit": 10924,
    "Invalid status - already resolved": 12978,
    "Not allowed": 14294,
    "Only admin can retry payouts": 15210,
    "Only admin": 16461,
    "Jetton wallet not set": 16651,
    "Payouts not in progress": 34715,
    "Already deposited": 35739,
    "Only seller can deposit": 36840,
    "Must be active - already resolved": 41175,
    "Seller must wait until deadline": 41485,
    "Deadline not reached": 48201,
    "Deposit already confirmed": 48396,
    "No deadline set": 50390,
    "Only seller can confirm": 55532,
    "No deposit to confirm": 55644,
    "Only admin can resolve": 57743,
    "No verified deposit": 60623,
    "Deposit not verified": 62616,
    "Only buyer can claim expired": 63402,
    "Only admin can confirm deposits": 63984,
} as const

const Escrow_types: ABIType[] = [
    {"name":"DataSize","header":null,"fields":[{"name":"cells","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bits","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"refs","type":{"kind":"simple","type":"int","optional":false,"format":257}}]},
    {"name":"SignedBundle","header":null,"fields":[{"name":"signature","type":{"kind":"simple","type":"fixed-bytes","optional":false,"format":64}},{"name":"signedData","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"StateInit","header":null,"fields":[{"name":"code","type":{"kind":"simple","type":"cell","optional":false}},{"name":"data","type":{"kind":"simple","type":"cell","optional":false}}]},
    {"name":"Context","header":null,"fields":[{"name":"bounceable","type":{"kind":"simple","type":"bool","optional":false}},{"name":"sender","type":{"kind":"simple","type":"address","optional":false}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"raw","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"SendParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"code","type":{"kind":"simple","type":"cell","optional":true}},{"name":"data","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"MessageParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"to","type":{"kind":"simple","type":"address","optional":false}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}}]},
    {"name":"DeployParameters","header":null,"fields":[{"name":"mode","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"body","type":{"kind":"simple","type":"cell","optional":true}},{"name":"value","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"bounce","type":{"kind":"simple","type":"bool","optional":false}},{"name":"init","type":{"kind":"simple","type":"StateInit","optional":false}}]},
    {"name":"StdAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":8}},{"name":"address","type":{"kind":"simple","type":"uint","optional":false,"format":256}}]},
    {"name":"VarAddress","header":null,"fields":[{"name":"workchain","type":{"kind":"simple","type":"int","optional":false,"format":32}},{"name":"address","type":{"kind":"simple","type":"slice","optional":false}}]},
    {"name":"BasechainAddress","header":null,"fields":[{"name":"hash","type":{"kind":"simple","type":"int","optional":true,"format":257}}]},
    {"name":"ConfirmDelivery","header":1,"fields":[]},
    {"name":"RaiseDispute","header":2,"fields":[]},
    {"name":"ResolveToBuyer","header":3,"fields":[]},
    {"name":"ResolveToSeller","header":4,"fields":[]},
    {"name":"CancelIfNoDeposit","header":5,"fields":[]},
    {"name":"ClaimExpired","header":6,"fields":[]},
    {"name":"EmergencyWithdraw","header":7,"fields":[]},
    {"name":"ConfirmDeposit","header":8,"fields":[]},
    {"name":"RetryPayout","header":9,"fields":[]},
    {"name":"TokenNotification","header":1935855772,"fields":[{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":128}},{"name":"from","type":{"kind":"simple","type":"address","optional":false}},{"name":"forwardPayload","type":{"kind":"simple","type":"slice","optional":false,"format":"remainder"}}]},
    {"name":"DepositReceived","header":16,"fields":[{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":128}},{"name":"from","type":{"kind":"simple","type":"address","optional":false}},{"name":"jettonWallet","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"DepositConfirmed","header":17,"fields":[{"name":"confirmedBy","type":{"kind":"simple","type":"address","optional":false}}]},
    {"name":"TradeCompleted","header":18,"fields":[{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"amount","type":{"kind":"simple","type":"uint","optional":false,"format":128}},{"name":"fee","type":{"kind":"simple","type":"uint","optional":false,"format":128}}]},
    {"name":"PayoutRetried","header":19,"fields":[{"name":"retriedBy","type":{"kind":"simple","type":"address","optional":false}},{"name":"queryId","type":{"kind":"simple","type":"uint","optional":false,"format":64}}]},
    {"name":"Escrow$Data","header":null,"fields":[{"name":"seller","type":{"kind":"simple","type":"address","optional":false}},{"name":"buyer","type":{"kind":"simple","type":"address","optional":false}},{"name":"admin","type":{"kind":"simple","type":"address","optional":false}},{"name":"expectedJettonWallet","type":{"kind":"simple","type":"address","optional":true}},{"name":"amount","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"commissionBps","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"feeW1","type":{"kind":"simple","type":"address","optional":false}},{"name":"feeW2","type":{"kind":"simple","type":"address","optional":false}},{"name":"feeW3","type":{"kind":"simple","type":"address","optional":false}},{"name":"status","type":{"kind":"simple","type":"int","optional":false,"format":257}},{"name":"deposited","type":{"kind":"simple","type":"uint","optional":false,"format":128}},{"name":"deadline","type":{"kind":"simple","type":"uint","optional":false,"format":32}},{"name":"jettonWallet","type":{"kind":"simple","type":"address","optional":true}},{"name":"depositVerified","type":{"kind":"simple","type":"bool","optional":false}},{"name":"payoutAttempted","type":{"kind":"simple","type":"bool","optional":false}}]},
]

const Escrow_opcodes = {
    "ConfirmDelivery": 1,
    "RaiseDispute": 2,
    "ResolveToBuyer": 3,
    "ResolveToSeller": 4,
    "CancelIfNoDeposit": 5,
    "ClaimExpired": 6,
    "EmergencyWithdraw": 7,
    "ConfirmDeposit": 8,
    "RetryPayout": 9,
    "TokenNotification": 1935855772,
    "DepositReceived": 16,
    "DepositConfirmed": 17,
    "TradeCompleted": 18,
    "PayoutRetried": 19,
}

const Escrow_getters: ABIGetter[] = [
]

export const Escrow_getterMapping: { [key: string]: string } = {
}

const Escrow_receivers: ABIReceiver[] = [
    {"receiver":"internal","message":{"kind":"typed","type":"TokenNotification"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ConfirmDelivery"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RaiseDispute"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ResolveToBuyer"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ResolveToSeller"}},
    {"receiver":"internal","message":{"kind":"typed","type":"CancelIfNoDeposit"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ClaimExpired"}},
    {"receiver":"internal","message":{"kind":"typed","type":"ConfirmDeposit"}},
    {"receiver":"internal","message":{"kind":"typed","type":"RetryPayout"}},
    {"receiver":"internal","message":{"kind":"typed","type":"EmergencyWithdraw"}},
]

export const USDT_MASTER = address("EQD0GKBM8ZbryVk2aESmzfU6b9b_8era_IkvBSELujFZPnc4");

export class Escrow implements Contract {
    
    public static readonly storageReserve = 0n;
    public static readonly errors = Escrow_errors_backward;
    public static readonly opcodes = Escrow_opcodes;
    
    static async init(seller_: Address, buyer_: Address, admin_: Address, amount_: bigint, commissionBps_: bigint, feeW1_: Address, feeW2_: Address, feeW3_: Address, deadline_: bigint, expectedJettonWallet_: Address | null) {
        return await Escrow_init(seller_, buyer_, admin_, amount_, commissionBps_, feeW1_, feeW2_, feeW3_, deadline_, expectedJettonWallet_);
    }
    
    static async fromInit(seller_: Address, buyer_: Address, admin_: Address, amount_: bigint, commissionBps_: bigint, feeW1_: Address, feeW2_: Address, feeW3_: Address, deadline_: bigint, expectedJettonWallet_: Address | null) {
        const __gen_init = await Escrow_init(seller_, buyer_, admin_, amount_, commissionBps_, feeW1_, feeW2_, feeW3_, deadline_, expectedJettonWallet_);
        const address = contractAddress(0, __gen_init);
        return new Escrow(address, __gen_init);
    }
    
    static fromAddress(address: Address) {
        return new Escrow(address);
    }
    
    readonly address: Address; 
    readonly init?: { code: Cell, data: Cell };
    readonly abi: ContractABI = {
        types:  Escrow_types,
        getters: Escrow_getters,
        receivers: Escrow_receivers,
        errors: Escrow_errors,
    };
    
    constructor(address: Address, init?: { code: Cell, data: Cell }) {
        this.address = address;
        this.init = init;
    }
    
    async send(provider: ContractProvider, via: Sender, args: { value: bigint, bounce?: boolean| null | undefined }, message: TokenNotification | ConfirmDelivery | RaiseDispute | ResolveToBuyer | ResolveToSeller | CancelIfNoDeposit | ClaimExpired | ConfirmDeposit | RetryPayout | EmergencyWithdraw) {
        
        let body: Cell | null = null;
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'TokenNotification') {
            body = beginCell().store(storeTokenNotification(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ConfirmDelivery') {
            body = beginCell().store(storeConfirmDelivery(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RaiseDispute') {
            body = beginCell().store(storeRaiseDispute(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ResolveToBuyer') {
            body = beginCell().store(storeResolveToBuyer(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ResolveToSeller') {
            body = beginCell().store(storeResolveToSeller(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'CancelIfNoDeposit') {
            body = beginCell().store(storeCancelIfNoDeposit(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ClaimExpired') {
            body = beginCell().store(storeClaimExpired(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'ConfirmDeposit') {
            body = beginCell().store(storeConfirmDeposit(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'RetryPayout') {
            body = beginCell().store(storeRetryPayout(message)).endCell();
        }
        if (message && typeof message === 'object' && !(message instanceof Slice) && message.$$type === 'EmergencyWithdraw') {
            body = beginCell().store(storeEmergencyWithdraw(message)).endCell();
        }
        if (body === null) { throw new Error('Invalid message type'); }
        
        await provider.internal(via, { ...args, body: body });
        
    }
    
}