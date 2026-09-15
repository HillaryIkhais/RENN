import { Contract, Wallet, formatUnits, parseUnits } from "ethers";
import { provider, ERC20_ABI } from "./contracts.js";

export const ETH = {
  async balanceOf(address: string): Promise<number> {
    const wei = await provider.getBalance(address);
    return Number(formatUnits(wei, 18));
  },
};

export const ERC20 = {
  async balanceOf(token: string, address: string): Promise<bigint> {
    const c = new Contract(token, ERC20_ABI, provider);
    return (await c.balanceOf(address)) as bigint;
  },

  async decimals(token: string): Promise<number> {
    const c = new Contract(token, ERC20_ABI, provider);
    return Number(await c.decimals());
  },

  async approve(token: string, spender: string, signer: Wallet): Promise<string> {
    const c = new Contract(token, ERC20_ABI, signer);
    const tx = await c.approve(spender, parseUnits("1000000", 6));
    const receipt = await tx.wait();
    return receipt.hash;
  },

  async transfer(
    token: string,
    recipient: string,
    amountUi: string,
    signer: Wallet
  ): Promise<string> {
    const c = new Contract(token, ERC20_ABI, signer);
    const decimals = await this.decimals(token);
    const tx = await c.transfer(recipient, parseUnits(amountUi, decimals));
    const receipt = await tx.wait();
    return receipt.hash;
  },
};