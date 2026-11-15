# ATest
Генератор интеграционных тестов на основе контрактов.

## Как запустить

1.  **Сервер**: 
    ```bash
    cd go-server
    go run .
    ```

2.  **Расширение**:
    ```bash
    cd ATest-exst
    npm install
    npm run compile
    ```
    Запустите расширение через `F5` в VS Code.

3.  **Использование**:
    - `Ctrl+Shift+P` -> `ATest: Init` (создаст примеры);
    - `Ctrl+Shift+P` -> `ATest: Open dashboard` -> кнопка **"Сгенерировать тесты"**.

Проект поддерживает автоматическое определение языка реализации и запуск тестов для C++, TypeScript, Python, Go и других языков.
# ATest
Генератор интеграционных тестов на основе контрактов.

## Как запустить

1.  **Сервер**: 
   https://github.com/Wql0t/go-server
```bash
    cd go-server
    go run .
    ```

2.  **Расширение**:
    ```bash
    cd ATest-exst
    npm install
    npm run compile
    ```
    Запустите расширение через `F5` в VS Code.

3.  **Использование**:
    - `Ctrl+Shift+P` -> `ATest: Init` (создаст примеры);
    - `Ctrl+Shift+P` -> `ATest: Open dashboard` -> кнопка **"Сгенерировать тесты"**.
