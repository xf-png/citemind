# Third-party components shipped with CiteMind v1.2

The application's license does not replace the licenses of these components.
Vendor files and model weights are redistributed without modification. CiteMind
changes only its own integration code to load these files from the same website.

| Component | Version | Attribution and license |
| --- | --- | --- |
| Transformers.js | 3.8.1 | Hugging Face and contributors; Apache-2.0. See [LICENSE](licenses/model-runtime/transformers-3.8.1-APACHE-2.0.txt). |
| ONNX Runtime Web | 1.22.0-dev.20250409-89f8206ba4 | Microsoft and contributors; [MIT](licenses/model-runtime/onnxruntime-1.22.0-dev-89f8206ba4-MIT.txt) and full [third-party notices](licenses/model-runtime/onnxruntime-89f8206ba4-ThirdPartyNotices.txt). |
| BGE small Chinese v1.5 | Xenova ONNX revision 75c43b069aac4d136ba6bc1122f995fedcfd2781 | BAAI/FlagOpen and Xenova; [MIT](licenses/model-runtime/FlagEmbedding-MIT.txt), upstream model cards and tokenizer/configuration files retained. |
| PDF.js | 6.4.299 | Mozilla Foundation and contributors; [Apache-2.0](vendor/pdfjs/6.4.299/LICENSE), [redistribution notice and additional font/decoder licenses](vendor/pdfjs/NOTICE). |

[Model/runtime license inventory](licenses/model-runtime/README.md) includes
the exact model cards, dependency licenses, package metadata, source URLs and
integrity verification records. This also records the upstream ISC declaration
for guid-typescript 1.0.9, which ships no standalone license text; no replacement
copyright notice has been invented.

Resource versions, upstream origins, byte lengths and SHA-256 values are recorded
in [model-assets.json](model-assets.json) and [pdf-assets.json](pdf-assets.json).
Original vendor copyright and attribution headers are retained.
