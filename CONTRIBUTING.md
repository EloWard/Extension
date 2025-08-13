# Contributing to EloWard

We welcome contributions from the community! This guide outlines how to contribute to the EloWard browser extension.

## Licensing

EloWard is licensed under **Apache 2.0 + Commons Clause**. This means:

✅ **You CAN:**
- Fork the repository
- Modify the code for personal use
- Submit pull requests with improvements
- Redistribute the code for non-commercial purposes
- Audit the code for security purposes

❌ **You CANNOT:**
- Sell the software or modified versions
- Use the software in a commercial product or service
- Host the software as a paid service (SaaS)

### Contributor Agreement

By submitting a contribution, you:
1. Certify you have the right to license your contribution under Apache 2.0 + Commons Clause
2. Agree that your contribution will be licensed under the same terms
3. Have read and agree to the Developer Certificate of Origin (DCO)

## Development Setup

1. Clone the repository
2. Generate a manifest for your target browser (one-time before loading):
   - Chrome (MV3): `node scripts/build-manifest.js chrome`
   - Firefox (MV2): `node scripts/build-manifest.js firefox`
3. Load the extension:
   - Chrome: open `chrome://extensions/`, enable Developer mode, click "Load unpacked", select the `EloWardApp` folder
   - Firefox: open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on...", select `EloWardApp/manifest.json`

## Contribution Process

1. **Fork** the repository
2. **Create a feature branch** from `main`
3. **Make your changes** following our coding standards
4. **Test thoroughly** - ensure no regressions
5. **Commit** with clear, descriptive messages
6. **Push** to your fork
7. **Submit a Pull Request** with:
   - Clear description of changes
   - Screenshots/videos if UI changes
   - Test cases covered

## Code Standards

- Use clear, descriptive variable names
- Add comments for complex logic
- Follow existing code style
- Ensure proper error handling
- Test OAuth flows thoroughly

## Security Considerations

Since EloWard handles user authentication:
- Never log sensitive data (tokens, passwords)
- Use secure communication (HTTPS only)
- Follow OAuth best practices
- Report security issues privately

## Areas We'd Love Help With

- **Performance optimizations** for large chat volumes
- **New rank badge designs** or animations
- **Support for additional games** beyond League of Legends
- **Accessibility improvements** for screen readers
- **Browser compatibility** testing
- **Localization** for international users

## Build & Packaging

- Auto-generate the manifest for each target:
  - Chrome: `node scripts/build-manifest.js chrome`
  - Firefox: `node scripts/build-manifest.js firefox`
- Optional release zips:
  - Chrome: `scripts/pack-chrome.sh`
  - Firefox: `scripts/pack-firefox.sh`

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Be respectful and constructive in discussions

Thank you for contributing to EloWard! 🎮✨ 