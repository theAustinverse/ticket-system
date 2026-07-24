import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { GenerateAiImageDto } from './dto/generate-ai-image.dto';

const MODEL = 'gemini-3.1-flash-image-preview';

export interface GeneratedImage {
  mimeType: string;
  base64: string;
}

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);
  private readonly client = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

  async generate(dto: GenerateAiImageDto): Promise<GeneratedImage> {
    if (!this.client) {
      throw new BadRequestException(
        'AI image generation is not configured (GEMINI_API_KEY missing)',
      );
    }

    const imageConfig: Record<string, string> = { imageSize: '1K' };
    if (dto.aspectRatio) {
      imageConfig.aspectRatio = dto.aspectRatio;
    }

    const response = await this.client.models.generateContent({
      model: MODEL,
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig,
      },
      contents: [{ role: 'user', parts: [{ text: dto.prompt }] }],
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((part) => part.inlineData);
    if (!imagePart?.inlineData?.data) {
      this.logger.warn(`Gemini returned no image for prompt: ${dto.prompt}`);
      throw new BadRequestException('AI did not return an image — try rephrasing the prompt');
    }

    return {
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      base64: imagePart.inlineData.data,
    };
  }
}
