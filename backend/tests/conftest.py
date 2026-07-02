import sys
from pathlib import Path

# Umożliwia `import app.*` przy uruchamianiu pytest z katalogu backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
