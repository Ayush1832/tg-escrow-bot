import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { Escrow } from '../build/Escrow/Escrow_Escrow';
import '@ton/test-utils';

describe('Escrow', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let escrow: SandboxContract<Escrow>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        escrow = blockchain.openContract(await Escrow.fromInit());

        deployer = await blockchain.treasury('deployer');

        const deployResult = await escrow.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            null,
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: escrow.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and escrow are ready to use
    });
});
