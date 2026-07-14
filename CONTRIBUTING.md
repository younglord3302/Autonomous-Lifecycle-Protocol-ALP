# Contributing to ALP

Thank you for your interest in contributing to the Autonomous Lifecycle Protocol!

## How to Contribute

### Reporting Issues
- Use GitHub Issues to report bugs or suggest features
- Include a minimal reproducible example when reporting parser bugs
- Tag issues with appropriate labels (`spec`, `cli`, `parser`, `sdk`, `docs`)

### Proposing Specification Changes
ALP uses an RFC (Request for Comments) process for specification changes:

1. Open a GitHub Issue describing the proposed change
2. Discuss the proposal with the community
3. If consensus is reached, submit a PR with the spec changes
4. Changes require approval from at least two maintainers
5. All spec changes must include updated compliance tests

### Code Contributions
1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes following the existing code style
4. Add tests for any new functionality
5. Ensure all tests pass (`npm test`)
6. Submit a Pull Request

### Documentation
Documentation improvements are always welcome. This includes:
- Fixing typos or unclear wording in the specification
- Adding examples
- Improving tutorials
- Translating documentation

## Development Setup

```bash
git clone https://github.com/YOUR_ORG/alp.git
cd alp
npm install
npm test
```

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/) code of conduct. Be respectful, inclusive, and constructive.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
