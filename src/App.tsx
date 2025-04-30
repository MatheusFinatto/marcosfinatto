function App() {
  return (
    <>
      <h1>Trabalhos:</h1>
      <ol>
        <li style={{ listStylePosition: "outside" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <span>Trabalho História - Michelangelo</span>
            <a href="/public/trab-michelangelo.pdf" target="_blank">
              Abrir no navegador
            </a>
            <a href="/public/trab-michelangelo.pdf" download>
              Baixar
            </a>
          </div>
        </li>
      </ol>
    </>
  );
}

export default App;
