from setuptools import setup, find_packages

setup(
    name="alp-sdk",
    version="15.2.0",
    packages=find_packages(),
    description="Official Python SDK for the Autonomous Lifecycle Protocol",
    author="ALP Contributors",
    install_requires=[
        "jsonschema>=4.18.0",
        "referencing>=0.30.0"
    ],
    extras_require={
        "signing": ["cryptography>=42.0.0"],
    },
)
