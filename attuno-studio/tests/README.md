# Backend Tests

Run the default backend suite from `attuno-studio/`:

```powershell
python -m pytest tests -q
```

## PostgreSQL Integration Tests

`tests/test_postgres_storage_integration.py` uses a real PostgreSQL database. It is skipped unless `TEST_DATABASE_URL` is set.

Example with an existing local PostgreSQL database:

```powershell
$env:TEST_DATABASE_URL = "postgresql://attuno_test:password@127.0.0.1:5432/attuno_test"
python -m pytest tests/test_postgres_storage_integration.py -q
```

Example with Docker:

```powershell
docker run --rm --name attuno-postgres-test -e POSTGRES_USER=attuno_test -e POSTGRES_PASSWORD=password -e POSTGRES_DB=attuno_test -p 54329:5432 postgres:16
```

In another terminal:

```powershell
$env:TEST_DATABASE_URL = "postgresql://attuno_test:password@127.0.0.1:54329/attuno_test"
python -m pytest tests/test_postgres_storage_integration.py -q
```

The test cleans only rows for generated `pg-migration-*` users. Use a disposable database anyway because migrations create project tables.
