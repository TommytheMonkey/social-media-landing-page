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
    'Render EXACTLY the subject, composition, and mood described above. Do NOT substitute a ' +
    'generic construction/jobsite scene, and do NOT add a person looking at a laptop, phone, ' +
    'tablet, or blueprints. High-quality, professional, editorial-grade. ' +
    'Absolutely NO text, words, numbers, logos, watermarks, or signage anywhere. ' +
    'Keep the bottom-right corner uncluttered and not pure-white/blown-out, so a small white ' +
    'logo stays legible when overlaid there.';

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
