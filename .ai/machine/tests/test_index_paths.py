import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location("organize", Path(__file__).resolve().parents[1] / "organize.py")
organize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(organize)


class IndexSourcePaths(unittest.TestCase):
    def test_relative_paths_use_repository_root_even_from_another_directory(self):
        old_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                self.assertTrue(organize.index_source_path(".ai/PROTOCOL.md").is_file())
                self.assertFalse(organize.index_source_path(".ai/missing-index-source").is_file())
            finally:
                os.chdir(old_cwd)

    def test_absolute_paths_are_preserved_and_missing_files_remain_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            existing = Path(directory) / "source.jsonl"
            existing.write_text("", encoding="utf-8")
            self.assertEqual(organize.index_source_path(str(existing)), existing)
            self.assertTrue(organize.index_source_path(str(existing)).is_file())
            self.assertFalse(organize.index_source_path(str(existing.with_name("missing"))).is_file())


if __name__ == "__main__":
    unittest.main()
