declare module 'mammoth' {
  interface MammothResult {
    value: string
    messages: string[]
  }

  interface Options {
    includeDefaultStyleMap?: boolean
    styleMap?: string | string[]
    includeEmbeddedStyleMap?: boolean
    includeHiddenText?: boolean
    includeAltText?: boolean
    convertImage?: (element: Image) => Promise<ImageConversion>
  }

  interface Image {
    contentType: string
    readAsArrayBuffer(): Promise<ArrayBuffer>
    readAsBase64(): Promise<string>
  }

  interface ImageConversion {
    src: string
    alt?: string
  }

  interface Input {
    arrayBuffer?: ArrayBuffer
    buffer?: ArrayBuffer
    path?: string
  }

  export function extractRawText(input: Input | ArrayBuffer | string): Promise<MammothResult>
  export function convertToHtml(input: Input | ArrayBuffer | string, options?: Options): Promise<MammothResult>
  export const images: {
    imgElement(image: Image): Promise<ImageConversion>
  }
}
