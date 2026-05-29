"""Allow running as: python -m seed"""

import asyncio

from src.seed.seed import main

if __name__ == "__main__":
    asyncio.run(main())
