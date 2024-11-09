export const getQuery = (name) => {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const queryValue = urlParams.get(name);
    return queryValue;
}

export const getRoomName = () => {
    return getQuery('id');
}