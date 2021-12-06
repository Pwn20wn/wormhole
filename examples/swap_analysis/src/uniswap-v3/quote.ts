import { ethers } from 'ethers';
import { abi as QuoterABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json';
import { Route, Trade } from '@uniswap/v3-sdk';
import { CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core';

import { mainnetProvider } from '../metamask';
import { State, UniswapV3PoolProducer } from '../uniswap-v3/pool';


const QUOTER_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';


export const BASE_AMOUNT_TINY = ethers.FixedNumber.from('0.0001');


export function makeMainnetQuoterContract() {
    return new ethers.Contract(QUOTER_ADDRESS, QuoterABI, mainnetProvider);
}


export interface QuotedPriceQty {
    price: number;
    qty: number;
}


export class UniswapV3PoolQuoter {
    quoterContract: ethers.Contract;
    public pool: UniswapV3PoolProducer;

    constructor() {
        // :O
    }

    async initialize(poolAddress: string) {
        this.pool = await UniswapV3PoolProducer.create(poolAddress);

        this.quoterContract = makeMainnetQuoterContract();
    }

    static async create(poolAddress: string): Promise<UniswapV3PoolQuoter> {
        const o = new UniswapV3PoolQuoter();
        await o.initialize(poolAddress);
        return o;
    }

    getLpState(): State {
        return this.pool.getLpState();
    }

    getTokenA(): Token {
        return this.pool.tokenA;
    }

    getTokenB(): Token {
        return this.pool.tokenB;
    }

    getTokenLegIndex(tokenAddress: string): number {
        const tokenA = this.getTokenA().address.toLowerCase();
        const tokenB = this.getTokenB().address.toLowerCase();

        const token = tokenAddress.toLowerCase();
        if (tokenA === token) {
            return 0;
        } else if (tokenB === token) {
            return 1;
        } else {
            throw new Error('invalid token address');
        }
    }

    getToken(tokenAddress: string): Token {
        if (this.getTokenLegIndex(tokenAddress) === 0) {
            return this.getTokenA();
        } else {
            return this.getTokenB();
        }
    }

    determineTokenInAndOut(tokenInAddress: string): Token[] {
        const tokenA = this.getTokenA();
        const tokenB = this.getTokenB();

        if (this.getTokenLegIndex(tokenInAddress) === 0) {
            return [tokenA, tokenB];
        } else {
            return [tokenB, tokenA];
        }
    }

    async computeAmountOut(tokenInAddress: string, amount: string): Promise<QuotedPriceQty> {
        const fixedAmount = ethers.FixedNumber.from(amount);

        const pool = this.pool;

        const [tokenIn, tokenOut] = this.determineTokenInAndOut(tokenInAddress);

        const multiplier = ethers.FixedNumber.from(
            ethers.BigNumber.from('10').pow(tokenIn.decimals).toString()
        );
        const amountInAttempt = fixedAmount.mulUnsafe(multiplier).toString();

        // hack to intify a large fixed number. brace yourselves
        if (!amountInAttempt.endsWith('.0')) {
            throw new Error('number not big enough?');
        }

        const amountIn = amountInAttempt.slice(0, -2);

        // call the quoter contract to determine the amount out of a swap, given an amount in
        const quotedAmountOut = await this.quoterContract.callStatic.quoteExactInputSingle(
            tokenIn.address,
            tokenOut.address,
            pool.fee,
            amountIn,
            0
        );

        // create an instance of the route object in order to construct a trade object
        const swapRoute = new Route([this.pool.makePool()], tokenIn, tokenOut);

        // create an unchecked trade instance
        const quote = await Trade.createUncheckedTrade({
            route: swapRoute,
            inputAmount: CurrencyAmount.fromRawAmount(tokenIn, amountIn.toString()),
            outputAmount: CurrencyAmount.fromRawAmount(
                tokenOut,
                quotedAmountOut.toString()
            ),
            tradeType: TradeType.EXACT_INPUT,
        });

        const fixedQty = ethers.FixedNumber.from(quote.outputAmount.toSignificant(12));
        const fixedPrice = fixedAmount.divUnsafe(fixedQty);

        const result: QuotedPriceQty = {
            price: Number(fixedPrice.toString()),
            qty: Number(fixedPrice.toString())
        };
        return result;
    }

}