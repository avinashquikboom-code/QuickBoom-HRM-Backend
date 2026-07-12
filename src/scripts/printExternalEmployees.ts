async function main() {
  const response = await fetch('https://hopkidapi.3dweb.in/api/Employee/GetEmployeeList', {
    method: 'GET',
    headers: {
      'x-api-key': 'HOPKID-MOBILE-ACCESS-API-KEY',
      'Content-Type': 'application/json',
    },
  });

  const result = await response.json();
  console.log('API RESULT (first 3):', JSON.stringify(result.data?.slice(0, 3), null, 2));
}

main().catch(err => console.error(err));
