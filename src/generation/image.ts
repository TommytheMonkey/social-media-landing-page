// Image generation: gpt-image-1 renders a text-free photoreal base, then we
// composite the white logo bottom-right (the style guide forbids the model from
// rendering text/logos — that's added here / later in Canva).

import sharp from 'sharp';
import { loadAsset } from '../lib/assets';
import { generateBaseImage } from '../clients/openaiImage';

const LOGO_REL = 'assets/brand/logo-white.png';

export interface RenderedImage {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

export async function generatePostImage(
  imagePrompt: string,
  filename: string,
): Promise<RenderedImage> {
  const prompt =
    `${imagePrompt}\n\n` +
    'Photorealistic, natural lighting, authentic commercial sitework/construction scene. ' +
    'Absolutely NO text, words, numbers, logos, watermarks, or signage anywhere. ' +
    'Keep the bottom-right corner relatively clean for a logo overlay.';

  const base = await generateBaseImage(prompt);
  const baseImg = sharp(base.bytes);
  const meta = await baseImg.metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  // White logo at ~18% of the image width, with a margin from the edges.
  const logoWidth = Math.round(width * 0.18);
  const logo = await sharp(loadAsset(LOGO_REL)).resize({ width: logoWidth }).png().toBuffer();
  const logoHeight = (await sharp(logo).metadata()).height ?? logoWidth;
  const margin = Math.round(width * 0.045);

  const composited = await baseImg
    .composite([{ input: logo, left: width - logoWidth - margin, top: height - logoHeight - margin }])
    .png()
    .toBuffer();

  return { bytes: composited, contentType: 'image/png', filename };
}
