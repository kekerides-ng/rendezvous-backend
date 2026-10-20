import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const signInSchema = z.object({
  /** The token Privy's client SDK hands back after it verifies the user. */
  providerToken: z.string().min(1),
});
export type SignInInput = z.infer<typeof signInSchema>;

export class SignInDto {
  @ApiProperty({ description: 'The access token from the Privy client SDK.' })
  providerToken!: string;
}

export class WalletDto {
  @ApiProperty() address!: string;
  @ApiProperty({ enum: ['ethereum', 'solana'], description: 'Chain family, not a chain id.' })
  chainType!: string;
  @ApiProperty({ enum: ['embedded', 'external'] }) kind!: string;
}

export class MeDto {
  @ApiProperty() id!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ description: 'KYC must pass before making or accepting an offer.' })
  kycVerified!: boolean;
  @ApiProperty({ type: [WalletDto] }) wallets!: WalletDto[];
}

export class SignInResponseDto extends MeDto {
  @ApiProperty({ description: 'True the first time this person has ever signed in.' })
  isNew!: boolean;
}
