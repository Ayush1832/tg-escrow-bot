import { toNano } from '@ton/core';
import { Escrow } from '../build/Escrow/Escrow_Escrow';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const escrow = provider.open(await Escrow.fromInit());

    await escrow.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(escrow.address);

    // run methods on `escrow`
}
